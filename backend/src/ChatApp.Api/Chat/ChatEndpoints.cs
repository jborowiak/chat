using System.Security.Claims;
using ChatApp.Api.Data;
using ChatApp.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Chat;

public static class ChatEndpoints
{
    public static void MapChat(this WebApplication app)
    {
        var api = app.MapGroup("/api").RequireAuthorization();
        api.MapGet("/contacts", GetContacts);
        api.MapGet("/conversations/{otherUserId}/messages", GetMessages);
        // TEMPORARY: removed in phase 5 when sending moves to the SignalR hub.
        api.MapPost("/conversations/{otherUserId}/messages", PostMessage);
    }

    private static string? UserId(ClaimsPrincipal p) => p.FindFirstValue(ClaimTypes.NameIdentifier);

    private static async Task<IResult> GetContacts(ClaimsPrincipal principal, ChatDbContext db, string? search, CancellationToken ct)
    {
        var me = UserId(principal);
        if (me is null) return Results.Unauthorized();

        var users = db.Users.Where(u => u.Id != me);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            users = users.Where(u => u.DisplayName.Contains(term));
        }
        var people = await users.Select(u => new { u.Id, u.DisplayName }).ToListAsync(ct);

        var convs = await db.ConversationMembers
            .Where(m => m.UserId == me)
            .Select(m => new
            {
                m.ConversationId,
                Other = m.Conversation.Members.Where(o => o.UserId != me).Select(o => o.UserId).FirstOrDefault(),
                m.Conversation.LastMessageAt,
                Unread = m.Conversation.Messages.Count(x => x.SenderId != me && x.Id > (m.LastReadMessageId ?? 0)),
                LastBody = m.Conversation.Messages.OrderByDescending(x => x.Id).Select(x => x.Body).FirstOrDefault(),
            })
            .ToListAsync(ct);
        var byOther = convs.Where(c => c.Other != null).ToDictionary(c => c.Other!);

        var result = people
            .Select(p => byOther.TryGetValue(p.Id, out var c)
                ? new ContactDto(p.Id, p.DisplayName, c.ConversationId,
                    c.LastBody is null ? null : ChatRules.Preview(c.LastBody), c.LastMessageAt is null ? null : AsUtc(c.LastMessageAt.Value), c.Unread, false)
                : new ContactDto(p.Id, p.DisplayName, null, null, null, 0, false))
            .OrderByDescending(c => c.LastMessageAt.HasValue)
            .ThenByDescending(c => c.LastMessageAt)
            .ThenBy(c => c.DisplayName, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        return Results.Ok(result);
    }

    private static async Task<IResult> GetMessages(
        string otherUserId, ClaimsPrincipal principal, ChatDbContext db,
        long? beforeId, long? afterId, int? limit, CancellationToken ct)
    {
        var me = UserId(principal);
        if (me is null) return Results.Unauthorized();
        if (otherUserId == me) return Results.BadRequest(new { error = "You can't message yourself." });
        if (!await db.Users.AnyAsync(u => u.Id == otherUserId, ct)) return Results.NotFound();

        // Looking the conversation up by the caller's own pair key is the membership check (BR-02).
        var pairKey = ChatRules.PairKey(me, otherUserId);
        var conversationId = await db.Conversations.Where(c => c.PairKey == pairKey).Select(c => (int?)c.Id).FirstOrDefaultAsync(ct);
        if (conversationId is null) return Results.Ok(Array.Empty<MessageDto>());

        var query = db.Messages.Where(m => m.ConversationId == conversationId);
        var take = ChatRules.ClampLimit(limit);
        List<Message> rows;
        if (afterId is not null)
        {
            // Gap-fill: oldest first, so the client can append in order.
            rows = await query.Where(m => m.Id > afterId).OrderBy(m => m.Id).Take(take).ToListAsync(ct);
        }
        else
        {
            if (beforeId is not null) query = query.Where(m => m.Id < beforeId);
            rows = await query.OrderByDescending(m => m.Id).Take(take).ToListAsync(ct);
        }
        return Results.Ok(rows.Select(ToDto));
    }

    private static async Task<IResult> PostMessage(
        string otherUserId, SendMessageRequest request, ClaimsPrincipal principal, ChatDbContext db, CancellationToken ct)
    {
        var me = UserId(principal);
        if (me is null) return Results.Unauthorized();
        if (otherUserId == me) return Results.BadRequest(new { error = "You can't message yourself." });
        if (!await db.Users.AnyAsync(u => u.Id == otherUserId, ct)) return Results.NotFound();

        var body = ChatRules.NormalizeBody(request.Body);
        if (body is null) return Results.BadRequest(new { error = $"Message must be 1 to {ChatRules.MaxBodyLength} characters." });

        var clientId = request.ClientMessageId ?? Guid.NewGuid();
        var existing = await db.Messages.FirstOrDefaultAsync(m => m.SenderId == me && m.ClientMessageId == clientId, ct);
        if (existing is not null) return Results.Ok(ToDto(existing));

        var pairKey = ChatRules.PairKey(me, otherUserId);
        var conversation = await db.Conversations.FirstOrDefaultAsync(c => c.PairKey == pairKey, ct);
        if (conversation is null)
        {
            conversation = new Conversation { PairKey = pairKey };
            conversation.Members.Add(new ConversationMember { UserId = me });
            conversation.Members.Add(new ConversationMember { UserId = otherUserId });
            db.Conversations.Add(conversation);
        }

        var now = DateTime.UtcNow;
        var message = new Message { Conversation = conversation, SenderId = me, Body = body, ClientMessageId = clientId, SentAt = now };
        conversation.LastMessageAt = now;
        db.Messages.Add(message);
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDto(message));
    }

    /// <summary>SQL Server returns Kind=Unspecified; mark as UTC so JSON gets a trailing Z.</summary>
    private static DateTime AsUtc(DateTime d) => DateTime.SpecifyKind(d, DateTimeKind.Utc);

    private static MessageDto ToDto(Message m) => new(m.Id, m.ConversationId, m.SenderId, m.Body, AsUtc(m.SentAt), m.ClientMessageId);
}
