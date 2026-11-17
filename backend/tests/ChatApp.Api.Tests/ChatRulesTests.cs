using ChatApp.Api.Chat;

namespace ChatApp.Api.Tests;

public class ChatRulesTests
{
    [Fact]
    public void PairKey_is_the_same_in_both_directions_and_ordered()
    {
        Assert.Equal("a:b", ChatRules.PairKey("a", "b"));
        Assert.Equal("a:b", ChatRules.PairKey("b", "a"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n\t")]
    public void NormalizeBody_rejects_empty_or_whitespace(string? body) =>
        Assert.Null(ChatRules.NormalizeBody(body));

    [Fact]
    public void NormalizeBody_trims_and_enforces_2000_limit()
    {
        Assert.Equal("hi", ChatRules.NormalizeBody("  hi  "));
        Assert.NotNull(ChatRules.NormalizeBody(new string('x', 2000)));
        Assert.Null(ChatRules.NormalizeBody(new string('x', 2001)));
    }

    [Theory]
    [InlineData(null, 50)]
    [InlineData(0, 1)]
    [InlineData(500, 100)]
    [InlineData(20, 20)]
    public void ClampLimit_keeps_page_size_in_range(int? input, int expected) =>
        Assert.Equal(expected, ChatRules.ClampLimit(input));

    [Fact]
    public void UnreadCount_counts_only_others_messages_after_read_position()
    {
        var msgs = new (string, long)[] { ("them", 1), ("me", 2), ("them", 3), ("them", 4) };
        Assert.Equal(3, ChatRules.UnreadCount(msgs, "me", null));
        Assert.Equal(2, ChatRules.UnreadCount(msgs, "me", 1));
        Assert.Equal(0, ChatRules.UnreadCount(msgs, "me", 4));
    }
}
