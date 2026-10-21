"""Creator and system management of independent service identities."""

import pytest

from syntara.authz.role_conventions import BUILTIN_POLICIES
from tests.unit.authz.conftest import build_opa_input, deny_policy, policies_for_role

SA_ACTIONS = sorted({p.action for p in BUILTIN_POLICIES if p.resource == "service_account"})


@pytest.mark.parametrize("action", SA_ACTIONS)
@pytest.mark.parametrize("role", ["admin", "authenticated", "auditor", "project-admin", "project-auditor"])
@pytest.mark.parametrize("is_creator", [False, True])
def test_account_management(opa_evaluate, action, role, is_creator):
    policies = policies_for_role(role)
    if role != "authenticated":
        policies += policies_for_role("authenticated")
    result = opa_evaluate(
        build_opa_input(
            action=action,
            resource_type="service_account",
            user_id="human",
            resource_metadata={"created_by": "human" if is_creator else "another-human"},
            effective_policies=policies,
        )
    )
    assert result["allow"] is (
        action == "create" or is_creator or role == "admin" or (role == "auditor" and action == "read")
    )


@pytest.mark.parametrize("action", SA_ACTIONS)
def test_explicit_deny_overrides_creator(opa_evaluate, action):
    result = opa_evaluate(
        build_opa_input(
            action=action,
            resource_type="service_account",
            user_id="human",
            resource_metadata={"created_by": "human"},
            effective_policies=[
                *policies_for_role("authenticated"),
                deny_policy("blocked", [f"service_account:{action}"]),
            ],
        )
    )
    assert result["allow"] is False
    assert result["denied_by"] == "blocked"
