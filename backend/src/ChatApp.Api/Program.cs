using ChatApp.Api.Auth;
using ChatApp.Api.Chat;
using ChatApp.Api.Data;
using ChatApp.Api.Data.Entities;
using ChatApp.Api.Hubs;
using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("Default")));

// Persist data protection keys in the database so bearer tokens survive restarts.
builder.Services.AddDataProtection()
    .SetApplicationName("ChatApp")
    .PersistKeysToDbContext<ChatDbContext>();

builder.Services.AddIdentityApiEndpoints<AppUser>(options =>
    {
        options.User.RequireUniqueEmail = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
    })
    .AddEntityFrameworkStores<ChatDbContext>();

builder.Services.AddAuthorization();
builder.Services.AddSignalR(o => o.MaximumReceiveMessageSize = 32 * 1024); // 32 KB cap (technical requirements section 8)
builder.Services.AddScoped<MessageService>();

// Browsers can't send headers on WebSocket requests, so SignalR sends the token as ?access_token=.
builder.Services.Configure<BearerTokenOptions>(IdentityConstants.BearerScheme, options =>
{
    options.Events.OnMessageReceived = context =>
    {
        var token = context.Request.Query["access_token"];
        if (!string.IsNullOrEmpty(token) && context.HttpContext.Request.Path.StartsWithSegments("/hubs/chat"))
            context.Token = token;
        return Task.CompletedTask;
    };
});

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "Healthy" }));

app.MapAuth();
app.MapChat();
app.MapHub<ChatHub>("/hubs/chat");

app.Run();

// Makes the entry point visible to WebApplicationFactory in tests.
public partial class Program { }
