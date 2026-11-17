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

/// <summary>Steps 1-4 and 6 of SendMessage (technical requirements section 5) plus the read marker of MarkRead.</summary>
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

        // Saving the message and the sender's read marker must succeed or fail together. The marker needs the generated
        // message id, so it is a second SaveChanges inside one transaction (skipped on the non-relational test provider).
        await using var tx = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(ct) : null;

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

        // The sender has read their own message (BR-09).
        var senderMember = conversation.Members.First(m => m.UserId == senderId);
        senderMember.LastReadMessageId = Math.Max(senderMember.LastReadMessageId ?? 0, message.Id);
        await db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);

        return new(SendFailure.None, MessageDto.From(message), false);
    }

    /// <summary>
    /// Moves the caller's read position forward (never back) and returns the stored value, or null if the caller is not a member.
    /// The requested id is capped at the newest message of the conversation, so a wrong or future id can't mark later messages read.
    /// </summary>
    public async Task<long?> MarkReadAsync(string userId, int conversationId, long lastReadMessageId, CancellationToken ct = default)
    {
        var member = await db.ConversationMembers.FirstOrDefaultAsync(m => m.ConversationId == conversationId && m.UserId == userId, ct);
        if (member is null) return null;
        var newest = await db.Messages.Where(m => m.ConversationId == conversationId).MaxAsync(m => (long?)m.Id, ct) ?? 0;
        var target = Math.Min(Math.Max(lastReadMessageId, 0), newest);
        if (target > (member.LastReadMessageId ?? 0))
        {
            member.LastReadMessageId = target;
            await db.SaveChangesAsync(ct);
        }
        return member.LastReadMessageId ?? 0;
    }

    private async Task<MessageDto?> FindDuplicate(string senderId, Guid clientMessageId, CancellationToken ct)
    {
        var m = await db.Messages.AsNoTracking().FirstOrDefaultAsync(x => x.SenderId == senderId && x.ClientMessageId == clientMessageId, ct);
        return m is null ? null : MessageDto.From(m);
    }
}
