using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ChatApp.Api.Data.Entities;
using Microsoft.AspNetCore.Identity;

namespace ChatApp.Api.Auth;

public record RegisterRequest(string? Email, string? Password, string? DisplayName);

public record MeResponse(string Id, string DisplayName, string? Email);

public static class AuthEndpoints
{
    /// <summary>
    /// Maps /api/auth/* (Identity API endpoints) and /api/me. The custom register endpoint
    /// has a lower order than the built-in one, so it wins the route and also sets DisplayName.
    /// </summary>
    public static void MapAuth(this WebApplication app)
    {
        var auth = app.MapGroup("/api/auth");
        auth.MapIdentityApi<AppUser>();

        auth.MapPost("/register", RegisterAsync)
            .Add(b => ((RouteEndpointBuilder)b).Order = -1);

        app.MapGet("/api/me", async (ClaimsPrincipal principal, UserManager<AppUser> users) =>
            {
                var user = await users.GetUserAsync(principal);
                return user is null
                    ? Results.Unauthorized()
                    : Results.Ok(new MeResponse(user.Id, user.DisplayName, user.Email));
            })
            .RequireAuthorization();
    }

    private static async Task<IResult> RegisterAsync(RegisterRequest request, UserManager<AppUser> users)
    {
        var errors = new Dictionary<string, string[]>();

        var email = request.Email?.Trim();
        if (string.IsNullOrEmpty(email) || !new EmailAddressAttribute().IsValid(email))
            errors["InvalidEmail"] = ["A valid e-mail address is required."];

        var displayName = request.DisplayName?.Trim();
        if (displayName is null || displayName.Length is < 2 or > 50)
            errors["InvalidDisplayName"] = ["Display name must be 2 to 50 characters."];

        if (string.IsNullOrEmpty(request.Password))
            errors["PasswordRequired"] = ["A password is required."];

        if (errors.Count > 0)
            return Results.ValidationProblem(errors);

        var user = new AppUser { UserName = email, Email = email, DisplayName = displayName! };
        var result = await users.CreateAsync(user, request.Password!);
        if (!result.Succeeded)
        {
            foreach (var e in result.Errors)
                errors[e.Code] = [.. errors.GetValueOrDefault(e.Code, []), e.Description];
            return Results.ValidationProblem(errors);
        }

        return Results.Ok();
    }
}
