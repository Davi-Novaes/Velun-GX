using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ScreenShare.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AccountNickname : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "nickname",
                table: "users",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "nickname",
                table: "users");
        }
    }
}
