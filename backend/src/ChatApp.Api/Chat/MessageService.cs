using ChatApp.Api.Data;
using ChatApp.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Chat;

public enum SendFailure { None, SelfMessage, UnknownRecipient, InvalidBody }

/// <summary>Outcome of a send. <see cref="IsDuplicate"/> is true when the clientMessageId was already stored.</summary>
public record SendResult(SendFailure Failure, MessageDto? Message, bool IsDuplicate)
{
    public bool Ok => Failure == SendFailure.None;
}

/// <summary>Steps 1-4 and 6 of SendMessage (technical requirements section 5): validate, get/create conversation, de-duplicate, save.</summary>
public class MessageService(ChatDbContext db)
{
    public async Task<SendResult> SendAsync(string senderId, string recipientId, Guid clientMessageId, string? rawBody, CancellationToken ct = default)
    {
        if (senderId == recipientId) return new(SendFailure.SelfMessage, null, false);
        var body = ChatRules.NormalizeBody(rawBody);
        if (body is null) return new(SendFailure.InvalidBody, null, false);
        if (!await db.Users.AnyAsync(u => u.Id == recipientId, ct)) return new(SendFailure.UnknownRecipient, null, false);

        var existing = await FindDuplicate(senderId, clientMessageId, ct);
        if (existing is not null) return new(SendFailure.None, existing, true);

        var pairKey = ChatRules.PairKey(senderId, recipientId);
        var conversation = await db.Conversations.Include(c => c.Members).FirstOrDefaultAsync(c => c.PairKey == pairKey, ct);
        if (conversation is null)
        {
            conversation = new Conversation { PairKey = pairKey };
            conversation.Members.Add(new ConversationMember { UserId = senderId });
            conversation.Members.Add(new ConversationMember { UserId = recipientId });
            db.Conversations.Add(conversation);
        }

        var now = DateTime.UtcNow;
        var message = new Message { Conversation = conversation, SenderId = senderId, Body = body, ClientMessageId = clientMessageId, SentAt = now };
        conversation.LastMessageAt = now;
        db.Messages.Add(message);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Two sends with the same clientMessageId raced past the check; the unique index let only one win.
            db.ChangeTracker.Clear();
            var winner = await FindDuplicate(senderId, clientMessageId, ct);
            if (winner is null) throw;
            return new(SendFailure.None, winner, true);
        }

        // The sender has read their own message (BR-09). Needs the generated id, so it is a second small write.
        var senderMember = conversation.Members.First(m => m.UserId == senderId);
        senderMember.LastReadMessageId = Math.Max(senderMember.LastReadMessageId ?? 0, message.Id);
        await db.SaveChangesAsync(ct);

        return new(SendFailure.None, MessageDto.From(message), false);
    }

    private async Task<MessageDto?> FindDuplicate(string senderId, Guid clientMessageId, CancellationToken ct)
    {
        var m = await db.Messages.AsNoTracking().FirstOrDefaultAsync(x => x.SenderId == senderId && x.ClientMessageId == clientMessageId, ct);
        return m is null ? null : MessageDto.From(m);
    }
}
