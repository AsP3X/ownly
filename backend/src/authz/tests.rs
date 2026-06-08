// Human: Unit tests for permission implication and catalog parsing.
// Agent: NO DB required; validates deny-wins helpers and catalog strings.

#[cfg(test)]
mod catalog_tests {
    use crate::authz::catalog::Permission;

    #[test]
    fn parse_instance_admin() {
        assert_eq!(
            Permission::parse("instance.admin").unwrap(),
            Permission::InstanceAdmin
        );
    }

    #[test]
    fn write_implies_read() {
        assert!(Permission::satisfies(
            Permission::ContentRead,
            Permission::ContentWrite
        ));
    }

    #[test]
    fn manage_acl_implies_share() {
        assert!(Permission::satisfies(
            Permission::ContentShare,
            Permission::ContentManageAcl
        ));
    }

    #[test]
    fn delete_does_not_imply_write() {
        assert!(!Permission::satisfies(
            Permission::ContentWrite,
            Permission::ContentDelete
        ));
    }
}
