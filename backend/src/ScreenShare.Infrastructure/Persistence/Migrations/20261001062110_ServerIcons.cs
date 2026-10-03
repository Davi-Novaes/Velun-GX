using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ScreenShare.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ServerIcons : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "icon",
                table: "community_servers",
                type: "character varying(90000)",
                maxLength: 90000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(256)",
                oldMaxLength: 256,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "icon",
                table: "community_servers",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(90000)",
                oldMaxLength: 90000,
                oldNullable: true);
        }
    }
}
