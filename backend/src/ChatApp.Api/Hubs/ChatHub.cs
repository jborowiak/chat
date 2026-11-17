using ChatApp.Api.Chat;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace ChatApp.Api.Hubs;

/// <summary>Server-to-client events. Phases 7 and 10 add read and presence events.</summary>
public interface IChatClient
{
    Task ReceiveMessage(MessageDto message);
    Task UserTyping(string userId);
    Task UserStoppedTyping(string userId);
}

[Authorize]
public class ChatHub(MessageService messages) : Hub<IChatClient>
{
    /// <summary>validate -> save -> push to recipient and sender's tabs -> return the saved message as the acknowledgement.</summary>
    public async Task<MessageDto> SendMessage(string recipientId, Guid clientMessageId, string body)
    {
        // The sender is always the authenticated caller, never a client-supplied value.
        var senderId = Context.UserIdentifier ?? throw new HubException("Not authenticated.");
        var result = await messages.SendAsync(senderId, recipientId, clientMessageId, body, Context.ConnectionAborted);
        if (!result.Ok)
        {
            throw new HubException(result.Failure switch
            {
                SendFailure.SelfMessage => "You can't message yourself.",
                SendFailure.UnknownRecipient => "Recipient not found.",
                _ => $"Message must be 1 to {ChatRules.MaxBodyLength} characters.",
            });
        }

        // A duplicate was already pushed the first time; only the acknowledgement is repeated.
        if (!result.IsDuplicate)
        {
            await Clients.Users(recipientId, senderId).ReceiveMessage(result.Message!);
        }
        return result.Message!;
    }

    /// <summary>Tells the recipient that the caller is typing. Not stored; the caller id comes from the token.</summary>
    public Task Typing(string recipientId) =>
        IsValidTarget(recipientId, out var senderId) ? Clients.User(recipientId).UserTyping(senderId) : Task.CompletedTask;

    public Task StopTyping(string recipientId) =>
        IsValidTarget(recipientId, out var senderId) ? Clients.User(recipientId).UserStoppedTyping(senderId) : Task.CompletedTask;

    // Ephemeral hints are silently dropped when malformed, so a bad call never breaks the connection.
    private bool IsValidTarget(string? recipientId, out string senderId)
    {
        senderId = Context.UserIdentifier ?? "";
        return senderId.Length > 0 && !string.IsNullOrWhiteSpace(recipientId) && recipientId != senderId;
    }
}
