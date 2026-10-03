using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ScreenShare.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ChannelAccountBinding : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "channel_security_stamp",
                table: "participants",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "channel_session_id",
                table: "participants",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_participants_channel_session_id",
                table: "participants",
                column: "channel_session_id");

            migrationBuilder.AddForeignKey(
                name: "fk_participants_account_sessions_channel_session_id",
                table: "participants",
                column: "channel_session_id",
                principalTable: "account_sessions",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_participants_account_sessions_channel_session_id",
                table: "participants");

            migrationBuilder.DropIndex(
                name: "ix_participants_channel_session_id",
                table: "participants");

            migrationBuilder.DropColumn(
                name: "channel_security_stamp",
                table: "participants");

            migrationBuilder.DropColumn(
                name: "channel_session_id",
                table: "participants");
        }
    }
}
