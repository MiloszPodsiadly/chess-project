"""Reproducible UCI fixed-position and parallel-load benchmark (Python 3.10+)."""
import argparse
import hashlib
import json
import os
import platform
import queue
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

POSITIONS = {
    "start": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "kiwipete": "r3k2r/p1ppqpb1/bn2pnp1/2pP4/1p2P3/2N2N2/PPQBBPPP/R3K2R w KQkq - 0 1",
    "mate_in_one": "7k/6pp/5KQ1/8/8/8/8/8 w - - 0 1",
    "promotion": "7k/P7/8/8/8/8/8/K7 w - - 0 1",
}


class Uci:
    def __init__(self, command):
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.lines = queue.Queue()
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        for line in self.process.stdout:
            self.lines.put(line.strip())

    def send(self, command):
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()

    def until(self, token, timeout=30):
        deadline = time.monotonic() + timeout
        output = []
        while time.monotonic() < deadline:
            try:
                line = self.lines.get(timeout=min(0.2, deadline - time.monotonic()))
            except queue.Empty:
                if self.process.poll() is not None:
                    raise RuntimeError("Engine exited before " + token)
                continue
            output.append(line)
            if line.startswith(token):
                return output
        raise TimeoutError("Engine did not return " + token)

    def close(self):
        try:
            self.send("quit")
            self.process.wait(timeout=2)
        except (BrokenPipeError, subprocess.TimeoutExpired):
            self.process.kill()


def run(command, threads, hash_mb, depth, names):
    engine = Uci(command)
    try:
        engine.send("uci")
        handshake = engine.until("uciok")
        identity = next((line[8:] for line in handshake if line.startswith("id name ")), "unknown")
        engine.send(f"setoption name Threads value {threads}")
        engine.send(f"setoption name Hash value {hash_mb}")
        engine.send("setoption name MultiPV value 1")
        engine.send("isready")
        engine.until("readyok")
        results = []
        for name in names:
            engine.send("ucinewgame")
            engine.send("isready")
            engine.until("readyok")
            engine.send("position fen " + POSITIONS[name])
            start = time.monotonic()
            engine.send(f"go depth {depth}")
            lines = engine.until("bestmove ", 60)
            info = next((line for line in reversed(lines) if line.startswith("info ") and " pv " in line), "")
            tokens = info.split()
            def metric(key):
                return int(tokens[tokens.index(key) + 1]) if key in tokens else None
            results.append({"position": name, "fen": POSITIONS[name], "bestmove": lines[-1].split()[1],
                            "depth": metric("depth"), "nodes": metric("nodes"), "nps": metric("nps"),
                            "score": tokens[tokens.index("score") + 1:tokens.index("score") + 3]
                            if "score" in tokens else None,
                            "elapsed_ms": round((time.monotonic() - start) * 1000)})
        return identity, results
    finally:
        engine.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", help="Local engine executable")
    parser.add_argument("--node-script", help="Previous Stockfish.js CLI script")
    parser.add_argument("--docker-container", help="Container with /usr/local/bin/stockfish")
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--hash", type=int, default=32)
    parser.add_argument("--depth", type=int, default=8)
    parser.add_argument("--concurrency", type=int, default=1)
    parser.add_argument("--label", default="candidate")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if sum(bool(value) for value in (args.engine, args.node_script, args.docker_container)) != 1:
        parser.error("Specify exactly one engine source")
    command = ([args.engine] if args.engine else
               [shutil.which("node") or "node", args.node_script] if args.node_script else
               ["docker", "exec", "-i", args.docker_container, "/usr/local/bin/stockfish"])
    if args.engine or args.node_script:
        artifact_hash = hashlib.sha256(Path(args.engine or args.node_script).read_bytes()).hexdigest()
    else:
        artifact_hash = subprocess.check_output(["docker", "exec", args.docker_container,
            "sha256sum", "/usr/local/bin/stockfish"], text=True).split()[0]
    try:
        import psutil
        physical_cores = psutil.cpu_count(logical=False)
    except ImportError:
        physical_cores = None
    names = list(POSITIONS)
    start = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        runs = list(pool.map(lambda _: run(command, args.threads, args.hash, args.depth, names),
                             range(args.concurrency)))
    report = {"label": args.label, "engine_id": runs[0][0], "sha256": artifact_hash,
              "architecture": platform.machine(), "logical_cores": os.cpu_count(),
              "physical_cores": physical_cores, "threads_per_engine": args.threads,
              "hash_mb_per_engine": args.hash, "depth": args.depth, "concurrency": args.concurrency,
              "positions": names, "searches": sum(len(result) for _, result in runs),
              "wall_ms": round((time.monotonic() - start) * 1000),
              "runs": [result for _, result in runs]}
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"{report['engine_id']}: {report['searches']} searches in {report['wall_ms']} ms -> {args.output}")


if __name__ == "__main__":
    main()
