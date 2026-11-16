using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace ChatApp.Api.Tests;

public class AuthEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Password = "Passw0rd!x";

    private static string NewEmail() => $"{Guid.NewGuid():N}@example.com";

    private Task<HttpResponseMessage> Register(HttpClient c, string email, string? name = "Alice", string password = Password) =>
        c.PostAsJsonAsync("/api/auth/register", new { email, password, displayName = name });

    private static async Task<JsonElement> Login(HttpClient c, string email, string password = Password)
    {
        var r = await c.PostAsJsonAsync("/api/auth/login", new { email, password });
        r.EnsureSuccessStatusCode();
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Register_login_and_me_returns_display_name()
    {
        var c = factory.CreateClient();
        var email = NewEmail();
        Assert.Equal(HttpStatusCode.OK, (await Register(c, email, "Alice A")).StatusCode);

        var tokens = await Login(c, email);
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/me");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());
        var res = await c.SendAsync(req);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var me = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Alice A", me.GetProperty("displayName").GetString());
        Assert.Equal(email, me.GetProperty("email").GetString());
    }

    [Fact]
    public async Task Me_without_token_is_401()
    {
        var res = await factory.CreateClient().GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("A")]
    public async Task Register_rejects_bad_display_name(string? name)
    {
        var res = await Register(factory.CreateClient(), NewEmail(), name);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Register_rejects_weak_password_and_duplicate_email()
    {
        var c = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Register(c, NewEmail(), "Bob", "abc")).StatusCode);

        var email = NewEmail();
        Assert.Equal(HttpStatusCode.OK, (await Register(c, email)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Register(c, email)).StatusCode);
    }

    [Fact]
    public async Task Refresh_returns_a_new_access_token()
    {
        var c = factory.CreateClient();
        var email = NewEmail();
        await Register(c, email);
        var tokens = await Login(c, email);

        var res = await c.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = tokens.GetProperty("refreshToken").GetString() });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var next = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrEmpty(next.GetProperty("accessToken").GetString()));
    }

    [Fact]
    public async Task Query_string_token_is_ignored_outside_the_hub_path()
    {
        var c = factory.CreateClient();
        var email = NewEmail();
        await Register(c, email);
        var token = (await Login(c, email)).GetProperty("accessToken").GetString();

        // The hub does not exist until phase 5, so only the negative case can be tested here:
        // the query token must NOT be honoured outside /hubs/chat.
        var meWithQuery = await c.GetAsync($"/api/me?access_token={token}");
        Assert.Equal(HttpStatusCode.Unauthorized, meWithQuery.StatusCode);
    }

    [Fact]
    public async Task Lockout_after_five_failed_logins()
    {
        var c = factory.CreateClient();
        var email = NewEmail();
        await Register(c, email);
        for (var i = 0; i < 5; i++)
            await c.PostAsJsonAsync("/api/auth/login", new { email, password = "wrong" });

        var res = await c.PostAsJsonAsync("/api/auth/login", new { email, password = Password });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }
}
