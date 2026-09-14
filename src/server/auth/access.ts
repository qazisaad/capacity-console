import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";

/** Role vocabulary is registered with the auth library; enforcement of every effect stays in app services. */
export const statement = {
  ...defaultStatements,
  capacity: ["read", "policy", "assign", "approve", "connector"],
} as const;
export const ac = createAccessControl(statement);
export const roles = {
  owner: ac.newRole({ ...ownerAc.statements, capacity: ["read", "policy", "assign", "approve", "connector"] }),
  admin: ac.newRole({ ...adminAc.statements, capacity: ["read", "policy", "assign", "approve"] }),
  member: ac.newRole({ ...memberAc.statements, capacity: ["read"] }),
  auditor: ac.newRole({ organization: [], member: [], invitation: [], team: [], ac: [], capacity: ["read"] }),
};
export type Role = keyof typeof roles;
export const ROLES = Object.keys(roles) as Role[];
export function isRole(value: string): value is Role { return (ROLES as string[]).includes(value); }
