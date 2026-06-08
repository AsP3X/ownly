// Human: Atomic permission system — catalog, resolver, grant CRUD, and instance gates.
// Agent: EXPORTS authorize, authorize_instance, grant helpers; USED by files/admin/permissions routes.

pub mod catalog;
pub mod grants;
pub mod resolver;

#[cfg(test)]
mod tests;

pub use catalog::Permission;
pub use grants::{
    count_enabled_admin_group_members, grant_content_for_user_share,
    grant_content_read_for_user_share,
    list_grants_for_resource, revoke_content_read_for_user_share, revoke_grant_by_id,
    seed_admin_group_for_user, sync_user_admin_group_membership, upsert_grant, GrantDto,
    UpsertGrantRequest,
};
pub use resolver::{
    authorize, authorize_instance, effective_jwt_role, folder_ancestor_chain,
    has_instance_permission, list_effective_instance_permissions, load_user_group_ids,
    user_is_admin_group_member, Effect, ResourceRef,
};
