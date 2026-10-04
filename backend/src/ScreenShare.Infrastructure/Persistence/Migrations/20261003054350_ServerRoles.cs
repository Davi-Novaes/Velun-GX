using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ScreenShare.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ServerRoles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "server_role_id",
                table: "server_members",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "server_roles",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    server_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    color = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false),
                    permissions = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_server_roles", x => x.id);
                    table.ForeignKey(
                        name: "fk_server_roles_community_servers_server_id",
                        column: x => x.server_id,
                        principalTable: "community_servers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_server_members_server_role_id",
                table: "server_members",
                column: "server_role_id");

            migrationBuilder.CreateIndex(
                name: "ix_server_roles_server_id_position",
                table: "server_roles",
                columns: new[] { "server_id", "position" });

            migrationBuilder.AddForeignKey(
                name: "fk_server_members_server_roles_server_role_id",
                table: "server_members",
                column: "server_role_id",
                principalTable: "server_roles",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_server_members_server_roles_server_role_id",
                table: "server_members");

            migrationBuilder.DropTable(
                name: "server_roles");

            migrationBuilder.DropIndex(
                name: "ix_server_members_server_role_id",
                table: "server_members");

            migrationBuilder.DropColumn(
                name: "server_role_id",
                table: "server_members");
        }
    }
}
