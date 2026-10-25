"""Estimate relative Elo from paired, color-reversed game results."""
import argparse
import json
import math
import random
from pathlib import Path

SCORE = {"win": 1.0, "draw": 0.5, "loss": 0.0}


def elo(score):
    score = min(1 - 1e-6, max(1e-6, score))
    return -400 * math.log10(1 / score - 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pairs", help="JSON array of [result as White, result as Black] for candidate")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    pairs = json.loads(Path(args.pairs).read_text(encoding="utf-8"))
    if not pairs or any(len(pair) != 2 or any(result not in SCORE for result in pair) for pair in pairs):
        parser.error("Expected nonempty pairs of win/draw/loss")
    pair_scores = [(SCORE[a] + SCORE[b]) / 2 for a, b in pairs]
    mean = sum(pair_scores) / len(pair_scores)
    rng = random.Random(19)
    estimates = sorted(elo(sum(rng.choices(pair_scores, k=len(pair_scores))) / len(pair_scores))
                       for _ in range(10000))
    report = {"pairs": len(pairs), "games": 2 * len(pairs), "score": mean,
              "relative_elo": round(elo(mean), 1),
              "bootstrap_95_ci": [round(estimates[250], 1), round(estimates[9749], 1)],
              "sufficient_for_conclusion": len(pairs) >= 200 and estimates[250] * estimates[9749] > 0,
              "method": "paired block bootstrap, 10000 resamples, seed 19"}
    Path(args.output).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
