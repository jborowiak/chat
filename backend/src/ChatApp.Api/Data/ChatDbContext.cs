using ChatApp.Api.Data.Entities;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Data;

public class ChatDbContext(DbContextOptions<ChatDbContext> options) : IdentityDbContext<AppUser>(options), IDataProtectionKeyContext
{
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ConversationMember> ConversationMembers => Set<ConversationMember>();
    public DbSet<Message> Messages => Set<Message>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<AppUser>(e =>
        {
            e.Property(u => u.DisplayName).HasMaxLength(50).IsRequired();
        });

        builder.Entity<Conversation>(e =>
        {
            e.Property(c => c.PairKey).HasMaxLength(901).IsRequired();
            e.HasIndex(c => c.PairKey).IsUnique();
        });

        builder.Entity<ConversationMember>(e =>
        {
            e.HasKey(m => new { m.ConversationId, m.UserId });
            e.HasIndex(m => m.UserId);
            e.HasOne(m => m.Conversation).WithMany(c => c.Members).HasForeignKey(m => m.ConversationId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Message>(e =>
        {
            e.Property(m => m.Body).HasMaxLength(2000).IsRequired();
            e.HasIndex(m => new { m.ConversationId, m.Id }).IsDescending(false, true);
            e.HasIndex(m => new { m.SenderId, m.ClientMessageId }).IsUnique();
            e.HasOne(m => m.Conversation).WithMany(c => c.Messages).HasForeignKey(m => m.ConversationId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.Sender).WithMany().HasForeignKey(m => m.SenderId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
