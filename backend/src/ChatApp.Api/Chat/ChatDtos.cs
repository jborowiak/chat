using ChatApp.Api.Data.Entities;

namespace ChatApp.Api.Chat;

public record ContactDto(
    string UserId,
    string DisplayName,
    int? ConversationId,
    string? LastMessagePreview,
    DateTime? LastMessageAt,
    int UnreadCount,
    bool IsOnline);

public record MessageDto(long Id, int ConversationId, string SenderId, string Body, DateTime SentAt, Guid ClientMessageId)
{
    public static MessageDto From(Message m) =>
        new(m.Id, m.ConversationId, m.SenderId, m.Body, AsUtc(m.SentAt), m.ClientMessageId);

    /// <summary>SQL Server returns Kind=Unspecified; mark as UTC so JSON gets a trailing Z.</summary>
    public static DateTime AsUtc(DateTime d) => DateTime.SpecifyKind(d, DateTimeKind.Utc);
}
