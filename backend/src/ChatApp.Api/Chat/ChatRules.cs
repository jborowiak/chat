namespace ChatApp.Api.Chat;

/// <summary>Pure business rules shared by the REST endpoints (and, from phase 5, the hub).</summary>
public static class ChatRules
{
    public const int MaxBodyLength = 2000;
    public const int PreviewLength = 80;
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 100;

    /// <summary>"{smallerUserId}:{largerUserId}" using ordinal ordering, so both users get the same key (BR-01).</summary>
    public static string PairKey(string userA, string userB) =>
        string.CompareOrdinal(userA, userB) <= 0 ? $"{userA}:{userB}" : $"{userB}:{userA}";

    /// <summary>Trims the body and checks BR-03 (1-2000 chars, not only whitespace). Returns null if invalid.</summary>
    public static string? NormalizeBody(string? body)
    {
        var trimmed = body?.Trim();
        return string.IsNullOrEmpty(trimmed) || trimmed.Length > MaxBodyLength ? null : trimmed;
    }

    public static int ClampLimit(int? limit) => Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize);

    public static string Preview(string body) =>
        body.Length <= PreviewLength ? body : body[..PreviewLength] + "...";

    /// <summary>Unread = messages from others newer than the read position (technical requirements section 3).</summary>
    public static int UnreadCount(IEnumerable<(string SenderId, long Id)> messages, string userId, long? lastReadMessageId) =>
        messages.Count(m => m.SenderId != userId && m.Id > (lastReadMessageId ?? 0));
}
