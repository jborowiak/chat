using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ChatApp.Api.Chat;
using Microsoft.Extensions.DependencyInjection;

namespace ChatApp.Api.Tests;

public class ChatEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Password = "Passw0rd!x";

    private sealed record TestUser(HttpClient Client, string Id, string Name);

    private async Task<TestUser> NewUser(string name)
    {
        var c = factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@example.com";
        (await c.PostAsJsonAsync("/api/auth/register", new { email, password = Password, displayName = name })).EnsureSuccessStatusCode();
        var login = await c.PostAsJsonAsync("/api/auth/login", new { email, password = Password });
        var tokens = await login.Content.ReadFromJsonAsync<JsonElement>();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());
        var me = await c.GetFromJsonAsync<JsonElement>("/api/me");
        return new TestUser(c, me.GetProperty("id").GetString()!, name);
    }

    /// <summary>Seeds a stored message through the same service the hub uses (sending itself is tested in ChatHubTests).</summary>
    private async Task Send(TestUser from, TestUser to, string body)
    {
        using var scope = factory.Services.CreateScope();
        var result = await scope.ServiceProvider.GetRequiredService<MessageService>().SendAsync(from.Id, to.Id, Guid.NewGuid(), body);
        Assert.True(result.Ok);
    }

    private static Task<JsonElement[]> History(TestUser who, TestUser other, string query = "") =>
        who.Client.GetFromJsonAsync<JsonElement[]>($"/api/conversations/{other.Id}/messages{query}")!;

    [Fact]
    public async Task Endpoints_require_authentication()
    {
        var c = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/contacts")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/conversations/x/messages")).StatusCode);
    }

    [Fact]
    public async Task Contacts_exclude_self_support_search_and_show_summary()
    {
        var tag = Guid.NewGuid().ToString("N")[..6];
        var a = await NewUser($"Alice{tag}");
        var b = await NewUser($"Bob{tag}");
        await NewUser($"Carol{tag}");

        await Send(b, a, "first");
        await Send(b, a, "second");

        var all = await a.Client.GetFromJsonAsync<JsonElement[]>($"/api/contacts?search={tag}");
        Assert.DoesNotContain(all!, c => c.GetProperty("userId").GetString() == a.Id);
        Assert.Equal(2, all!.Length);
        // Conversation with Bob sorts first, Carol (no messages) after.
        Assert.Equal(b.Id, all[0].GetProperty("userId").GetString());
        Assert.Equal(2, all[0].GetProperty("unreadCount").GetInt32());
        Assert.Equal("second", all[0].GetProperty("lastMessagePreview").GetString());
        Assert.Equal(JsonValueKind.Null, all[1].GetProperty("conversationId").ValueKind);

        var filtered = await a.Client.GetFromJsonAsync<JsonElement[]>($"/api/contacts?search=Bob{tag}");
        Assert.Single(filtered!);

        // The sender has nothing unread.
        var bobView = await b.Client.GetFromJsonAsync<JsonElement[]>($"/api/contacts?search=Alice{tag}");
        Assert.Equal(0, bobView![0].GetProperty("unreadCount").GetInt32());
    }

    [Fact]
    public async Task History_is_newest_first_and_pages_with_beforeId()
    {
        var a = await NewUser("Alice");
        var b = await NewUser("Bob");
        for (var i = 1; i <= 5; i++) await Send(a, b, $"m{i}");

        var page1 = await History(b, a, "?limit=2");
        Assert.Equal(["m5", "m4"], page1.Select(m => m.GetProperty("body").GetString()));

        var beforeId = page1[^1].GetProperty("id").GetInt64();
        var page2 = await History(b, a, $"?limit=2&beforeId={beforeId}");
        Assert.Equal(["m3", "m2"], page2.Select(m => m.GetProperty("body").GetString()));
    }

    [Fact]
    public async Task History_afterId_returns_newer_messages_oldest_first()
    {
        var a = await NewUser("Alice");
        var b = await NewUser("Bob");
        for (var i = 1; i <= 4; i++) await Send(a, b, $"m{i}");
        var all = await History(a, b);
        var secondId = all[^2].GetProperty("id").GetInt64(); // m2

        var gap = await History(a, b, $"?afterId={secondId}");
        Assert.Equal(["m3", "m4"], gap.Select(m => m.GetProperty("body").GetString()));
    }

    [Fact]
    public async Task Third_user_cannot_see_a_conversation_between_two_others()
    {
        var a = await NewUser("Alice");
        var b = await NewUser("Bob");
        var eve = await NewUser("Eve");
        await Send(a, b, "secret");

        // Eve asks for her own conversation with Alice or Bob: it's a different, empty one.
        Assert.Empty(await History(eve, a));
        Assert.Empty(await History(eve, b));
        Assert.Single(await History(b, a));
    }

    [Fact]
    public async Task History_rejects_self_and_unknown_user()
    {
        var a = await NewUser("Alice");
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.GetAsync($"/api/conversations/{a.Id}/messages")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await a.Client.GetAsync("/api/conversations/nobody/messages")).StatusCode);
    }

    [Fact]
    public async Task Temporary_POST_send_endpoint_is_gone()
    {
        var a = await NewUser("Alice");
        var b = await NewUser("Bob");
        var r = await a.Client.PostAsJsonAsync($"/api/conversations/{b.Id}/messages", new { body = "hi" });
        Assert.Equal(HttpStatusCode.MethodNotAllowed, r.StatusCode);
    }
}
