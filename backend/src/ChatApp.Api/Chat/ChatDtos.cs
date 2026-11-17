namespace ChatApp.Api.Chat;

public record ContactDto(
    string UserId,
    string DisplayName,
    int? ConversationId,
    string? LastMessagePreview,
    DateTime? LastMessageAt,
    int UnreadCount,
    bool IsOnline);

public record MessageDto(long Id, int ConversationId, string SenderId, string Body, DateTime SentAt, Guid ClientMessageId);

public record SendMessageRequest(string? Body, Guid? ClientMessageId);
