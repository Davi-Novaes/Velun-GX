# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY global.json Directory.Build.props Directory.Packages.props .editorconfig ./
COPY src/ScreenShare.Domain/ScreenShare.Domain.csproj src/ScreenShare.Domain/
COPY src/ScreenShare.Application/ScreenShare.Application.csproj src/ScreenShare.Application/
COPY src/ScreenShare.Infrastructure/ScreenShare.Infrastructure.csproj src/ScreenShare.Infrastructure/
COPY src/ScreenShare.Api/ScreenShare.Api.csproj src/ScreenShare.Api/
RUN dotnet restore src/ScreenShare.Api/ScreenShare.Api.csproj
COPY src/ src/
RUN dotnet publish src/ScreenShare.Api/ScreenShare.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
RUN mkdir -p /var/lib/screenshare/keys && chown "$APP_UID" /var/lib/screenshare/keys
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_gcServer=0
EXPOSE 8080
# sem curl na imagem: health check via /dev/tcp do bash
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --start-interval=1s --retries=3 \
  CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080 && printf "GET /health/live HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3 && head -1 <&3 | grep -q " 200 "'
ENTRYPOINT ["dotnet", "ScreenShare.Api.dll"]
