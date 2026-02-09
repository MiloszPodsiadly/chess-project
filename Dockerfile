FROM gradle:8.7-jdk21 AS build
WORKDIR /workspace
COPY . .
RUN chmod +x gradlew

RUN ./gradlew --no-daemon -x test :chess-server:bootJar

FROM eclipse-temurin:21-jre

RUN groupadd -r app && useradd -r -g app -s /usr/sbin/nologin app
WORKDIR /app

COPY --from=build /workspace/chess-server/build/libs/*.jar app.jar

RUN chown -R app:app /app
USER app

ENV JAVA_OPTS=""

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
