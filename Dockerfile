FROM debian:bookworm-slim AS stockfish-build
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl g++ make && rm -rf /var/lib/apt/lists/*
WORKDIR /stockfish
RUN curl -fsSL 'https://github.com/official-stockfish/Stockfish/archive/edb0d9db6731067ec50ce619ff372b463bc4dd5d.tar.gz' -o source.tar.gz \
    && echo '4fc20699a5ecf7883b036ce180020f5e57979623ad719fd2a52839209521581b  source.tar.gz' | sha256sum -c - \
    && tar -xzf source.tar.gz --strip-components=1
RUN case "$TARGETARCH" in amd64) sf_arch=x86-64 ;; arm64) sf_arch=armv8 ;; *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; esac \
    && make -C src -j2 build ARCH="$sf_arch" \
    && test -x src/stockfish

FROM gradle:8.7-jdk21 AS build
WORKDIR /workspace
COPY . .
RUN chmod +x gradlew

RUN ./gradlew --no-daemon -x test :chess-server:bootJar

FROM eclipse-temurin:21-jre

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

RUN groupadd -r app && useradd -r -g app -s /usr/sbin/nologin app
WORKDIR /app

COPY --from=build /workspace/chess-server/build/libs/*.jar app.jar
COPY --from=stockfish-build /stockfish/src/stockfish /usr/local/bin/stockfish
COPY --from=stockfish-build /stockfish/Copying.txt /usr/share/doc/stockfish/Copying.txt
COPY --from=stockfish-build /stockfish/source.tar.gz /usr/share/doc/stockfish/source.tar.gz

RUN chown -R app:app /app
USER app

ENV JAVA_OPTS=""
ENV STOCKFISH_PATH=/usr/local/bin/stockfish

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
