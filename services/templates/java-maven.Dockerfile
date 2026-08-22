# Java (Maven) — works for plain Maven apps and Spring Boot.
FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /app

COPY . .

# spring-boot-maven-plugin's repackage leaves an extra "original-*.jar"
# alongside the runnable jar — pick the non-original one.
RUN mvn -B -q -DskipTests package \
    && cp $(ls target/*.jar | grep -v original | head -1) target/app.jar

FROM eclipse-temurin:21-jre

WORKDIR /app

COPY --from=build /app/target/app.jar app.jar

EXPOSE 8080

CMD ["java", "-jar", "app.jar"]
