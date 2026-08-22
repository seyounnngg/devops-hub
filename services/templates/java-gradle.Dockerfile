# Java (Gradle) — works for plain Gradle apps and Spring Boot.
FROM gradle:8-jdk21 AS build

WORKDIR /app

COPY . .

# Spring Boot's Gradle plugin also produces a "*-plain.jar" (classes only,
# no dependencies) alongside the runnable jar — pick the non-plain one.
RUN gradle build -x test --no-daemon \
    && cp $(ls build/libs/*.jar | grep -v plain | head -1) build/libs/app.jar

FROM eclipse-temurin:21-jre

WORKDIR /app

COPY --from=build /app/build/libs/app.jar app.jar

EXPOSE 8080

CMD ["java", "-jar", "app.jar"]
