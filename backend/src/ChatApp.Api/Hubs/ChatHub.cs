using ChatApp.Api.Chat;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace ChatApp.Api.Hubs;

/// <summary>Server-to-client events. Phases 6, 7 and 10 add typing, read and presence events.</summary>
public interface IChatClient
{
    Task ReceiveMessage(MessageDto message);
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
}
