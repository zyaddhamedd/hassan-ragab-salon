"""add Mini device proof-of-possession keys and replay protection

Revision ID: zj_mini_device_proof
Revises: zi_mini_device_strict_binding
Create Date: 2026-09-23 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "zj_mini_device_proof"
down_revision = "zi_mini_device_strict_binding"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("branch_registered_devices") as batch_op:
        batch_op.add_column(sa.Column("proof_public_key_jwk", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("proof_key_thumbprint", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("proof_key_algorithm", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("proof_key_version", sa.Integer(), server_default="1", nullable=False))
        batch_op.add_column(sa.Column("proof_key_required", sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column("proof_key_registered_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("proof_key_rotated_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("last_proof_verified_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_unique_constraint(
            "uq_branch_registered_devices_proof_key_thumbprint",
            ["proof_key_thumbprint"],
        )
        batch_op.create_check_constraint(
            "ck_branch_registered_devices_proof_key_version_positive",
            "proof_key_version > 0",
        )

    op.create_table(
        "mini_device_proof_challenges",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("nonce_hash", sa.String(length=128), nullable=False),
        sa.Column(
            "purpose",
            sa.Enum(
                "ENROLLMENT",
                "LOGIN",
                "REFRESH",
                name="mini_device_proof_challenge_purpose_enum",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("branch_id", sa.Integer(), nullable=False),
        sa.Column("registered_device_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(length=255), nullable=False),
        sa.Column("proof_key_thumbprint", sa.String(length=64), nullable=True),
        sa.Column("proof_key_version", sa.Integer(), nullable=False),
        sa.Column("expected_origin", sa.String(length=512), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["registered_device_id"],
            ["branch_registered_devices.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mini_device_proof_challenges_purpose", "mini_device_proof_challenges", ["purpose"])
    op.create_index("ix_mini_device_proof_challenges_branch_id", "mini_device_proof_challenges", ["branch_id"])
    op.create_index("ix_mini_device_proof_challenges_registered_device_id", "mini_device_proof_challenges", ["registered_device_id"])
    op.create_index("ix_mini_device_proof_challenges_expires_at", "mini_device_proof_challenges", ["expires_at"])

    op.create_table(
        "mini_device_proof_replays",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("proof_key_thumbprint", sa.String(length=64), nullable=False),
        sa.Column("jti", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "proof_key_thumbprint",
            "jti",
            name="uq_mini_device_proof_replay_thumbprint_jti",
        ),
    )
    op.create_index("ix_mini_device_proof_replays_expires_at", "mini_device_proof_replays", ["expires_at"])


def downgrade():
    op.drop_index("ix_mini_device_proof_replays_expires_at", table_name="mini_device_proof_replays")
    op.drop_table("mini_device_proof_replays")
    op.drop_index("ix_mini_device_proof_challenges_expires_at", table_name="mini_device_proof_challenges")
    op.drop_index("ix_mini_device_proof_challenges_registered_device_id", table_name="mini_device_proof_challenges")
    op.drop_index("ix_mini_device_proof_challenges_branch_id", table_name="mini_device_proof_challenges")
    op.drop_index("ix_mini_device_proof_challenges_purpose", table_name="mini_device_proof_challenges")
    op.drop_table("mini_device_proof_challenges")

    with op.batch_alter_table("branch_registered_devices") as batch_op:
        batch_op.drop_constraint(
            "ck_branch_registered_devices_proof_key_version_positive",
            type_="check",
        )
        batch_op.drop_constraint(
            "uq_branch_registered_devices_proof_key_thumbprint",
            type_="unique",
        )
        batch_op.drop_column("last_proof_verified_at")
        batch_op.drop_column("proof_key_rotated_at")
        batch_op.drop_column("proof_key_registered_at")
        batch_op.drop_column("proof_key_required")
        batch_op.drop_column("proof_key_version")
        batch_op.drop_column("proof_key_algorithm")
        batch_op.drop_column("proof_key_thumbprint")
        batch_op.drop_column("proof_public_key_jwk")
