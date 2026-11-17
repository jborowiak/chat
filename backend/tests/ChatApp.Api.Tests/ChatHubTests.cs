using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using ChatApp.Api.Chat;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

namespace ChatApp.Api.Tests;

public class ChatHubTests(ApiFactory factory) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private const string Password = "Passw0rd!x";
    private readonly List<HubConnection> _connections = [];

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var c in _connections) await c.DisposeAsync();
    }

    private sealed record Client(HubConnection Hub, Channel<MessageDto> Received, Channel<string> Typing, Channel<(int ConversationId, long LastRead)> Reads, string Id, string Token, string Name);

    private async Task<(string Id, string Token)> Register(string name)
    {
        var c = factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@example.com";
        (await c.PostAsJsonAsync("/api/auth/register", new { email, password = Password, displayName = name })).EnsureSuccessStatusCode();
        var tokens = await (await c.PostAsJsonAsync("/api/auth/login", new { email, password = Password })).Content.ReadFromJsonAsync<JsonElement>();
        var token = tokens.GetProperty("accessToken").GetString()!;
        c.DefaultRequestHeaders.Authorization = new("Bearer", token);
        var me = await c.GetFromJsonAsync<JsonElement>("/api/me");
        return (me.GetProperty("id").GetString()!, token);
    }

    private async Task<Client> Connect(string id, string token, string name)
    {
        var received = Channel.CreateUnbounded<MessageDto>();
        // The token goes in the query string (?access_token=), exactly like a browser WebSocket.
        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/hubs/chat"), o =>
            {
                o.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                o.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();
        var typing = Channel.CreateUnbounded<string>();
        hub.On<MessageDto>("ReceiveMessage", m => received.Writer.TryWrite(m));
        hub.On<string>("UserTyping", u => typing.Writer.TryWrite("typing:" + u));
        hub.On<string>("UserStoppedTyping", u => typing.Writer.TryWrite("stopped:" + u));
        var reads = Channel.CreateUnbounded<(int, long)>();
        hub.On<int, long>("ConversationRead", (c, m) => reads.Writer.TryWrite((c, m)));
        _connections.Add(hub);
        await hub.StartAsync();
        return new Client(hub, received, typing, reads, id, token, name);
    }

    private async Task<Client> NewClient(string name)
    {
        var (id, token) = await Register(name);
        return await Connect(id, token, name);
    }

    private HttpClient HttpFor(string token)
    {
        var http = factory.CreateClient();
        http.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return http;
    }

    private static async Task<MessageDto> Next(Client c)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        return await c.Received.Reader.ReadAsync(cts.Token);
    }

    private static async Task AssertNothing(Client c)
    {
        await Task.Delay(300);
        Assert.False(c.Received.Reader.TryRead(out _));
    }

    [Fact]
    public async Task Hub_requires_authentication()
    {
        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/hubs/chat"), o =>
            {
                o.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
            })
            .Build();
        _connections.Add(hub);
        await Assert.ThrowsAnyAsync<Exception>(() => hub.StartAsync());
    }

    [Fact]
    public async Task Message_goes_to_recipient_and_to_the_senders_tabs_and_is_stored()
    {
        var a = await NewClient("Alice");
        var b = await NewClient("Bob");
        var a2 = await Connect(a.Id, a.Token, a.Name); // Alice's second tab
        var id = Guid.NewGuid();

        var ack = await a.Hub.InvokeAsync<MessageDto>("SendMessage", b.Id, id, "  hello  ");

        Assert.Equal("hello", ack.Body); // trimmed
        Assert.Equal(a.Id, ack.SenderId);
        Assert.Equal(id, ack.ClientMessageId);
        Assert.Equal(ack, await Next(b));
        Assert.Equal(ack, await Next(a));  // the sender's own connection also gets the push
        Assert.Equal(ack, await Next(a2)); // and so does the other tab

        // Stored: Bob sees it in history, and it is unread for Bob but not for Alice.
        var http = HttpFor(b.Token);
        Assert.Single((await http.GetFromJsonAsync<MessageDto[]>($"/api/conversations/{a.Id}/messages"))!);
        var contacts = await http.GetFromJsonAsync<ContactDto[]>("/api/contacts");
        Assert.Equal(1, contacts!.Single(c => c.UserId == a.Id).UnreadCount);
        contacts = await HttpFor(a.Token).GetFromJsonAsync<ContactDto[]>("/api/contacts");
        Assert.Equal(0, contacts!.Single(c => c.UserId == b.Id).UnreadCount);
    }

    [Fact]
    public async Task WebSocket_transport_authenticates_with_the_access_token_query_string()
    {
        // Browsers can't set headers on a WebSocket, so the token travels as ?access_token= (technical requirements section 7).
        var (aId, aToken) = await Register("Alice");
        var (bId, bToken) = await Register("Bob");
        var received = Channel.CreateUnbounded<MessageDto>();
        var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/hubs/chat"), o =>
            {
                o.Transports = HttpTransportType.WebSockets;
                o.SkipNegotiation = true;
                o.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
                // Do what a browser does: put the token in the query string of the WebSocket URL.
                o.WebSocketFactory = (context, ct) => new ValueTask<System.Net.WebSockets.WebSocket>(
                    factory.Server.CreateWebSocketClient().ConnectAsync(
                        new Uri($"{context.Uri}{(string.IsNullOrEmpty(context.Uri.Query) ? "?" : "&")}access_token={Uri.EscapeDataString(bToken)}"), ct));
            })
            .Build();
        hub.On<MessageDto>("ReceiveMessage", m => received.Writer.TryWrite(m));
        _connections.Add(hub);
        await hub.StartAsync();

        var a = await Connect(aId, aToken, "Alice");
        await a.Hub.InvokeAsync<MessageDto>("SendMessage", bId, Guid.NewGuid(), "over websocket");

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        Assert.Equal("over websocket", (await received.Reader.ReadAsync(cts.Token)).Body);
    }

    [Fact]
    public async Task Duplicate_clientMessageId_is_acknowledged_but_not_stored_or_pushed_again()
    {
        var a = await NewClient("Alice");
        var b = await NewClient("Bob");
        var id = Guid.NewGuid();

        var first = await a.Hub.InvokeAsync<MessageDto>("SendMessage", b.Id, id, "once");
        await Next(b);
        var second = await a.Hub.InvokeAsync<MessageDto>("SendMessage", b.Id, id, "once");

        Assert.Equal(first.Id, second.Id);
        await AssertNothing(b);
        Assert.Single((await HttpFor(b.Token).GetFromJsonAsync<MessageDto[]>($"/api/conversations/{a.Id}/messages"))!);
    }

    [Fact]
    public async Task Invalid_sends_are_rejected_and_nothing_is_delivered()
    {
        var a = await NewClient("Alice");
        var b = await NewClient("Bob");

        await Assert.ThrowsAsync<HubException>(() => a.Hub.InvokeAsync<MessageDto>("SendMessage", b.Id, Guid.NewGuid(), "   "));
        await Assert.ThrowsAsync<HubException>(() => a.Hub.InvokeAsync<MessageDto>("SendMessage", b.Id, Guid.NewGuid(), new string('x', 2001)));
        await Assert.ThrowsAsync<HubException>(() => a.Hub.InvokeAsync<MessageDto>("SendMessage", a.Id, Guid.NewGuid(), "me"));
        await Assert.ThrowsAsync<HubException>(() => a.Hub.InvokeAsync<MessageDto>("SendMessage", "nobody", Guid.NewGuid(), "hi"));
        await AssertNothing(b);

        var ok = await a.Hub.InvokeAsync<MessageDto>("SendMessage", b.Id, Guid.NewGuid(), new string('x', 2000));
        Assert.Equal(2000, ok.Body.Length);
    }

    [Fact]
    public async Task Third_user_receives_nothing()
    {
        var a = await NewClient("Alice");
        var b = await NewClient("Bob");
        var eve = await NewClient("Eve");
        await a.Hub.InvokeAsync<MessageDto>("SendMessage", b.Id, Guid.NewGuid(), "secret");
        await Next(b);
        await AssertNothing(eve);
    }

    [Fact]
    public async Task Offline_recipient_gets_the_message_from_history_later()
    {
        var a = await NewClient("Alice");
        var (bId, bToken) = await Register("Bob"); // Bob has no hub connection
        await a.Hub.InvokeAsync<MessageDto>("SendMessage", bId, Guid.NewGuid(), "while you were away");

        var history = await HttpFor(bToken).GetFromJsonAsync<MessageDto[]>($"/api/conversations/{a.Id}/messages");
        Assert.Equal("while you were away", history!.Single().Body);
    }

    private static async Task<string> NextTyping(Client c)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        return await c.Typing.Reader.ReadAsync(cts.Token);
    }

    [Fact]
    public async Task Typing_and_stop_typing_are_forwarded_to_the_recipient_only_with_the_callers_id()
    {
        var a = await NewClient("Alice");
        var b = await NewClient("Bob");
        var eve = await NewClient("Eve");
        var a2 = await Connect(a.Id, a.Token, a.Name);

        await a.Hub.InvokeAsync("Typing", b.Id);
        Assert.Equal($"typing:{a.Id}", await NextTyping(b));
        await a.Hub.InvokeAsync("StopTyping", b.Id);
        Assert.Equal($"stopped:{a.Id}", await NextTyping(b));

        await Task.Delay(300);
        Assert.False(eve.Typing.Reader.TryRead(out _)); // a third user hears nothing
        Assert.False(a.Typing.Reader.TryRead(out _));   // and neither does the sender's own tabs
        Assert.False(a2.Typing.Reader.TryRead(out _));
        Assert.False(b.Received.Reader.TryRead(out _)); // typing is never stored or sent as a message
        Assert.Empty((await HttpFor(b.Token).GetFromJsonAsync<MessageDto[]>($"/api/conversations/{a.Id}/messages"))!);
    }

    [Fact]
    public async Task Typing_to_self_or_nobody_is_ignored_without_breaking_the_connection()
    {
        var a = await NewClient("Alice");
        var b = await NewClient("Bob");

        await a.Hub.InvokeAsync("Typing", a.Id);
        await a.Hub.InvokeAsync("Typing", "");
        await a.Hub.InvokeAsync("StopTyping", "nobody");
        await Task.Delay(300);
        Assert.False(a.Typing.Reader.TryRead(out _));

        await a.Hub.InvokeAsync("Typing", b.Id); // still works
        Assert.Equal($"typing:{a.Id}", await NextTyping(b));
    }

    private async Task<int> UnreadFor(Client viewer, Client other) =>
        (await HttpFor(viewer.Token).GetFromJsonAsync<ContactDto[]>("/api/contacts"))!.Single(c => c.UserId == other.Id).UnreadCount;

    private static async Task<(int ConversationId, long LastRead)> NextRead(Client c)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        return await c.Reads.Reader.ReadAsync(cts.Token);
    }

    [Fact]
    public async Task MarkRead_clears_the_unread_count_and_tells_the_callers_other_tab_but_not_the_sender()
    {
        var a = await NewClient("Alice");
        var b = await NewClient("Bob");
        var a2 = await Connect(a.Id, a.Token, a.Name); // Alice's second tab
        MessageDto last = null!;
        for (var i = 0; i < 3; i++) last = await b.Hub.InvokeAsync<MessageDto>("SendMessage", a.Id, Guid.NewGuid(), $"m{i}");
        for (var i = 0; i < 3; i++) await Next(a);
        Assert.Equal(3, await UnreadFor(a, b));

        await a.Hub.InvokeAsync("MarkRead", last.ConversationId, last.Id);

        Assert.Equal(0, await UnreadFor(a, b));
        Assert.Equal((last.ConversationId, last.Id), await NextRead(a));
        Assert.Equal((last.ConversationId, last.Id), await NextRead(a2));
        await Task.Delay(200);
        Assert.False(b.Reads.Reader.TryRead(out _)); // Bob's badges are not affected
    }

    [Fact]
    public async Task MarkRead_never_moves_backwards_and_cannot_mark_future_messages_read()
    {
        var a = await NewClient("Alice");
        var b = await NewClient("Bob");
        var first = await b.Hub.InvokeAsync<MessageDto>("SendMessage", a.Id, Guid.NewGuid(), "one");
        var second = await b.Hub.InvokeAsync<MessageDto>("SendMessage", a.Id, Guid.NewGuid(), "two");

        await a.Hub.InvokeAsync("MarkRead", first.ConversationId, second.Id);
        await a.Hub.InvokeAsync("MarkRead", first.ConversationId, first.Id); // older value: ignored
        Assert.Equal((first.ConversationId, second.Id), await NextRead(a));
        Assert.Equal((first.ConversationId, second.Id), await NextRead(a)); // the stored (max) value is what is pushed

        // A huge id is capped at the newest message, so a message sent later is still unread.
        await a.Hub.InvokeAsync("MarkRead", first.ConversationId, long.MaxValue);
        Assert.Equal((first.ConversationId, second.Id), await NextRead(a));
        await b.Hub.InvokeAsync<MessageDto>("SendMessage", a.Id, Guid.NewGuid(), "three");
        Assert.Equal(1, await UnreadFor(a, b));
    }

    [Fact]
    public async Task MarkRead_rejects_a_conversation_the_caller_is_not_a_member_of()
    {
        var a = await NewClient("Alice");
        var b = await NewClient("Bob");
        var eve = await NewClient("Eve");
        var m = await b.Hub.InvokeAsync<MessageDto>("SendMessage", a.Id, Guid.NewGuid(), "secret");

        await Assert.ThrowsAsync<HubException>(() => eve.Hub.InvokeAsync("MarkRead", m.ConversationId, m.Id));
        await Assert.ThrowsAsync<HubException>(() => eve.Hub.InvokeAsync("MarkRead", 99999, 1L));
        Assert.Equal(1, await UnreadFor(a, b)); // untouched
    }

    [Fact]
    public async Task Sending_marks_the_senders_own_message_read_in_the_same_write()
    {
        var a = await NewClient("Alice");
        var b = await NewClient("Bob");
        await a.Hub.InvokeAsync<MessageDto>("SendMessage", b.Id, Guid.NewGuid(), "hi");
        Assert.Equal(0, await UnreadFor(a, b));
        Assert.Equal(1, await UnreadFor(b, a));
    }
}
