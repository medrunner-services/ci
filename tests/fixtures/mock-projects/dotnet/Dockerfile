FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src
COPY Mock.Container.App/Mock.Container.App.csproj Mock.Container.App/
RUN dotnet restore Mock.Container.App/Mock.Container.App.csproj
COPY Mock.Container.App Mock.Container.App
RUN dotnet publish Mock.Container.App/Mock.Container.App.csproj -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
WORKDIR /app
COPY --from=build /out .
ENTRYPOINT ["dotnet", "Mock.Container.App.dll"]
