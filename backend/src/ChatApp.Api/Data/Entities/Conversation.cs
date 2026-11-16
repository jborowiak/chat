namespace ChatApp.Api.Data.Entities;

public class Conversation
{
    public int Id { get; set; }

    /// <summary>"{smallerUserId}:{largerUserId}" - one conversation per pair of users.</summary>
    public string PairKey { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastMessageAt { get; set; }

    public List<ConversationMember> Members { get; set; } = [];
    public List<Message> Messages { get; set; } = [];
}
