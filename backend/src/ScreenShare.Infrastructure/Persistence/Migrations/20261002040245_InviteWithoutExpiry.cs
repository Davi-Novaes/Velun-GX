using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ScreenShare.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InviteWithoutExpiry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<DateTimeOffset>(
                name: "expires_at",
                table: "server_invites",
                type: "timestamp with time zone",
                nullable: true,
                oldClrType: typeof(DateTimeOffset),
                oldType: "timestamp with time zone");

            // links já enviados e ainda válidos também deixam de expirar (expirados ou revogados continuam como estão)
            migrationBuilder.Sql("UPDATE server_invites SET expires_at = NULL WHERE revoked_at IS NULL AND expires_at > now();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // volta ao prazo antigo (7 dias) em vez do valor padrão "ano 1", que invalidaria todos os convites
            migrationBuilder.Sql("UPDATE server_invites SET expires_at = now() + interval '7 days' WHERE expires_at IS NULL;");

            migrationBuilder.AlterColumn<DateTimeOffset>(
                name: "expires_at",
                table: "server_invites",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)),
                oldClrType: typeof(DateTimeOffset),
                oldType: "timestamp with time zone",
                oldNullable: true);
        }
    }
}
