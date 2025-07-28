import { Jsonify } from "type-fest";

import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { View } from "@bitwarden/common/models/view/view";
import { CollectionId } from "@bitwarden/common/types/guid";
import { ITreeNodeObject } from "@bitwarden/common/vault/models/domain/tree-node";

import { Collection, CollectionType, CollectionTypes } from "./collection";
import { CollectionData } from "./collection.data";
import { CollectionAccessDetailsResponse, CollectionDetailsResponse } from "./collection.response";

export const NestingDelimiter = "/";

export class CollectionView implements View, ITreeNodeObject {
  id: CollectionId | undefined;
  organizationId: string;
  name: string;
  externalId: string | undefined;
  // readOnly applies to the items within a collection
  readOnly: boolean = false;
  hidePasswords: boolean = false;
  manage: boolean = false;
  assigned: boolean = false;
  type: CollectionType = CollectionTypes.SharedCollection;

  constructor(c: Collection | CollectionAccessDetailsResponse, name: string) {
    if (c.organizationId == null) {
      throw new Error("@TODO");
    }

    this.id = c.id;
    this.organizationId = c.organizationId;
    this.name = name;
    this.externalId = c.externalId;
    if (c instanceof Collection) {
      this.readOnly = c.readOnly;
      this.hidePasswords = c.hidePasswords;
      this.manage = c.manage;
      this.assigned = true;
    }
    if (c instanceof CollectionAccessDetailsResponse) {
      this.assigned = c.assigned;
    }
    this.type = c.type;
  }

  canEditItems(org: Organization): boolean {
    if (org != null && org.id !== this.organizationId) {
      throw new Error(
        "Id of the organization provided does not match the org id of the collection.",
      );
    }

    return org?.canEditAllCiphers || this.manage || (this.assigned && !this.readOnly);
  }

  /**
   * Returns true if the user can edit a collection (including user and group access) from the individual vault.
   * Does not include admin permissions - see {@link CollectionAdminView.canEdit}.
   */
  canEdit(org: Organization | undefined): boolean {
    if (this.isDefaultCollection) {
      return false;
    }

    if (org != null && org.id !== this.organizationId) {
      throw new Error(
        "Id of the organization provided does not match the org id of the collection.",
      );
    }

    return this.manage;
  }

  /**
   * Returns true if the user can delete a collection from the individual vault.
   * Does not include admin permissions - see {@link CollectionAdminView.canDelete}.
   */
  canDelete(org: Organization | undefined): boolean {
    if (org != null && org.id !== this.organizationId) {
      throw new Error(
        "Id of the organization provided does not match the org id of the collection.",
      );
    }

    const canDeleteManagedCollections = !org?.limitCollectionDeletion || org.isAdmin;

    // Only use individual permissions, not admin permissions
    return canDeleteManagedCollections && this.manage && !this.isDefaultCollection;
  }

  /**
   * Returns true if the user can view collection info and access in a read-only state from the individual vault
   */
  canViewCollectionInfo(org: Organization | undefined): boolean {
    return false;
  }

  static fromJSON(obj: Jsonify<CollectionView>) {
    const cd = new CollectionData(new CollectionDetailsResponse({ ...obj }));
    return Object.assign(new CollectionView(new Collection(cd), obj.name), obj);
  }

  get isDefaultCollection() {
    return this.type == CollectionTypes.DefaultUserCollection;
  }
}
