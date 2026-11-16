namespace ChatApp.Api.Data.Entities;

public class ConversationMember
{
    public int ConversationId { get; set; }
    public string UserId { get; set; } = string.Empty;
    public long? LastReadMessageId { get; set; }

    public Conversation Conversation { get; set; } = null!;
    public AppUser User { get; set; } = null!;
}
