namespace ChatApp.Api.Data.Entities;

public class Message
{
    public long Id { get; set; }
    public int ConversationId { get; set; }
    public string SenderId { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public Guid ClientMessageId { get; set; }
    public DateTime SentAt { get; set; } = DateTime.UtcNow;

    public Conversation Conversation { get; set; } = null!;
    public AppUser Sender { get; set; } = null!;
}
