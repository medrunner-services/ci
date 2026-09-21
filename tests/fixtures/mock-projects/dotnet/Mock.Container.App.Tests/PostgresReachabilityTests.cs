using System;
using System.Net.Sockets;
using System.Threading.Tasks;
using Xunit;

public sealed class PostgresReachabilityTests
{
    [Fact]
    public async Task PostgresServiceIsReachable()
    {
        var host = Environment.GetEnvironmentVariable("POSTGRES_HOST");
        var port = int.Parse(Environment.GetEnvironmentVariable("POSTGRES_PORT") ?? "0");
        Assert.Equal("127.0.0.1", host);

        using var client = new TcpClient();
        await client.ConnectAsync(host!, port);
        Assert.True(client.Connected);
    }
}
