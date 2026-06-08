// Human: Typed permission catalog with implication graph for atomic grant checks.
// Agent: VALIDATES grant strings; EXPANDS permissions for resolver deny/allow evaluation.

use crate::error::AppError;

/// Human: Stable permission identifiers stored in permission_grants.permission.
/// Agent: SERIALIZED as dotted strings; PARSED from API grant payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    // Instance scope
    InstanceAdmin,
    InstanceSettingsRead,
    InstanceSettingsManage,
    InstanceUsersRead,
    InstanceUsersManage,
    InstanceGroupsRead,
    InstanceGroupsManage,
    InstancePermissionsManage,
    InstanceAuditRead,
    // Content scope
    ContentRead,
    ContentWrite,
    ContentDelete,
    ContentShare,
    ContentManageAcl,
}

impl Permission {
    // Human: Wire/API representation for grant rows and JSON responses.
    // Agent: RETURNS stable catalog string matching migration seed and spec.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InstanceAdmin => "instance.admin",
            Self::InstanceSettingsRead => "instance.settings.read",
            Self::InstanceSettingsManage => "instance.settings.manage",
            Self::InstanceUsersRead => "instance.users.read",
            Self::InstanceUsersManage => "instance.users.manage",
            Self::InstanceGroupsRead => "instance.groups.read",
            Self::InstanceGroupsManage => "instance.groups.manage",
            Self::InstancePermissionsManage => "instance.permissions.manage",
            Self::InstanceAuditRead => "instance.audit.read",
            Self::ContentRead => "content.read",
            Self::ContentWrite => "content.write",
            Self::ContentDelete => "content.delete",
            Self::ContentShare => "content.share",
            Self::ContentManageAcl => "content.manage_acl",
        }
    }

    // Human: Parse client/admin grant strings into catalog variants.
    // Agent: RETURNS BadRequest when unknown permission slug.
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value.trim() {
            "instance.admin" => Ok(Self::InstanceAdmin),
            "instance.settings.read" => Ok(Self::InstanceSettingsRead),
            "instance.settings.manage" => Ok(Self::InstanceSettingsManage),
            "instance.users.read" => Ok(Self::InstanceUsersRead),
            "instance.users.manage" => Ok(Self::InstanceUsersManage),
            "instance.groups.read" => Ok(Self::InstanceGroupsRead),
            "instance.groups.manage" => Ok(Self::InstanceGroupsManage),
            "instance.permissions.manage" => Ok(Self::InstancePermissionsManage),
            "instance.audit.read" => Ok(Self::InstanceAuditRead),
            "content.read" => Ok(Self::ContentRead),
            "content.write" => Ok(Self::ContentWrite),
            "content.delete" => Ok(Self::ContentDelete),
            "content.share" => Ok(Self::ContentShare),
            "content.manage_acl" => Ok(Self::ContentManageAcl),
            other => Err(AppError::BadRequest(format!("unknown permission: {other}"))),
        }
    }

    // Human: All instance permissions for instance.admin superset expansion.
    // Agent: USED by resolver when checking instance.admin grant.
    pub fn all_instance() -> &'static [Self] {
        &[
            Self::InstanceAdmin,
            Self::InstanceSettingsRead,
            Self::InstanceSettingsManage,
            Self::InstanceUsersRead,
            Self::InstanceUsersManage,
            Self::InstanceGroupsRead,
            Self::InstanceGroupsManage,
            Self::InstancePermissionsManage,
            Self::InstanceAuditRead,
        ]
    }

    // Human: Permissions that satisfy a content.read check when granted (implication rule).
    // Agent: READS grant row permission; MATCHES if grant implies required permission.
    pub fn satisfies(required: Self, granted: Self) -> bool {
        if required == granted {
            return true;
        }
        match required {
            Self::InstanceAdmin => granted == Self::InstanceAdmin,
            Self::InstanceSettingsRead => matches!(
                granted,
                Self::InstanceAdmin | Self::InstanceSettingsRead | Self::InstanceSettingsManage
            ),
            Self::InstanceSettingsManage => {
                matches!(granted, Self::InstanceAdmin | Self::InstanceSettingsManage)
            }
            Self::InstanceUsersRead => matches!(
                granted,
                Self::InstanceAdmin | Self::InstanceUsersRead | Self::InstanceUsersManage
            ),
            Self::InstanceUsersManage => {
                matches!(granted, Self::InstanceAdmin | Self::InstanceUsersManage)
            }
            Self::InstanceGroupsRead => matches!(
                granted,
                Self::InstanceAdmin | Self::InstanceGroupsRead | Self::InstanceGroupsManage
            ),
            Self::InstanceGroupsManage => {
                matches!(granted, Self::InstanceAdmin | Self::InstanceGroupsManage)
            }
            Self::InstancePermissionsManage => {
                matches!(granted, Self::InstanceAdmin | Self::InstancePermissionsManage)
            }
            Self::InstanceAuditRead => {
                matches!(granted, Self::InstanceAdmin | Self::InstanceAuditRead)
            }
            Self::ContentRead => matches!(
                granted,
                Self::ContentWrite
                    | Self::ContentDelete
                    | Self::ContentShare
                    | Self::ContentManageAcl
            ),
            Self::ContentWrite => matches!(granted, Self::ContentManageAcl),
            Self::ContentShare => matches!(granted, Self::ContentManageAcl),
            Self::ContentDelete | Self::ContentManageAcl => false,
        }
    }

    // Human: Content permissions assignable on files/folders via ACL UI.
    // Agent: RETURNS list for share dialog checkboxes.
    pub fn content_assignable() -> &'static [Self] {
        &[
            Self::ContentRead,
            Self::ContentWrite,
            Self::ContentDelete,
            Self::ContentShare,
            Self::ContentManageAcl,
        ]
    }

    // Human: Instance permissions listable in admin grant UI (excludes admin shortcut row).
    // Agent: EXCLUDES InstanceAdmin from explicit grant picker — use admin group instead.
    pub fn instance_assignable() -> &'static [Self] {
        &[
            Self::InstanceSettingsRead,
            Self::InstanceSettingsManage,
            Self::InstanceUsersRead,
            Self::InstanceUsersManage,
            Self::InstanceGroupsRead,
            Self::InstanceGroupsManage,
            Self::InstancePermissionsManage,
            Self::InstanceAuditRead,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::Permission;

    #[test]
    fn content_write_implies_read() {
        assert!(Permission::satisfies(
            Permission::ContentRead,
            Permission::ContentWrite
        ));
    }

    #[test]
    fn instance_admin_implies_users_read() {
        assert!(Permission::satisfies(
            Permission::InstanceUsersRead,
            Permission::InstanceAdmin
        ));
    }
}
