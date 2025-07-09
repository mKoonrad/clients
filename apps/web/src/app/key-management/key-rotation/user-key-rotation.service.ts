import { Injectable } from "@angular/core";
import { firstValueFrom, Observable } from "rxjs";

import { Account } from "@bitwarden/common/auth/abstractions/account.service";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { CryptoFunctionService } from "@bitwarden/common/key-management/crypto/abstractions/crypto-function.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { DeviceTrustServiceAbstraction } from "@bitwarden/common/key-management/device-trust/abstractions/device-trust.service.abstraction";
import { WrappedSigningKey } from "@bitwarden/common/key-management/keys/models/signing-key";
import { VerifyingKey } from "@bitwarden/common/key-management/keys/models/verifying-key";
import { SecurityStateService } from "@bitwarden/common/key-management/security-state/abstractions/security-state.service";
import { SignedSecurityState as SignedSecurityState } from "@bitwarden/common/key-management/security-state/models/security-state";
import { VaultTimeoutService } from "@bitwarden/common/key-management/vault-timeout";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { SdkClientFactory } from "@bitwarden/common/platform/abstractions/sdk/sdk-client-factory";
import { SdkLoadService } from "@bitwarden/common/platform/abstractions/sdk/sdk-load.service";
import { EncryptionType, HashPurpose } from "@bitwarden/common/platform/enums";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { EncString } from "@bitwarden/common/platform/models/domain/enc-string";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { SendService } from "@bitwarden/common/tools/send/services/send.service.abstraction";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { SyncService } from "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction";
import { DialogService, ToastService } from "@bitwarden/components";
import { KdfConfig, KdfConfigService, KeyService } from "@bitwarden/key-management";
import {
  AccountRecoveryTrustComponent,
  EmergencyAccessTrustComponent,
  KeyRotationTrustInfoComponent,
} from "@bitwarden/key-management-ui";
import { PureCrypto, TokenProvider, UserCryptoV2Response } from "@bitwarden/sdk-internal";

import { OrganizationUserResetPasswordService } from "../../admin-console/organizations/members/services/organization-user-reset-password/organization-user-reset-password.service";
import { WebauthnLoginAdminService } from "../../auth/core";
import { EmergencyAccessService } from "../../auth/emergency-access";

import { AccountKeysRequest } from "./request/account-keys.request";
import { MasterPasswordUnlockDataRequest } from "./request/master-password-unlock-data.request";
import { RotateUserAccountKeysRequest } from "./request/rotate-user-account-keys.request";
import { UnlockDataRequest } from "./request/unlock-data.request";
import { UserDataRequest } from "./request/userdata.request";
import { UserKeyRotationApiService } from "./user-key-rotation-api.service";

type MasterPasswordAuthenticationAndUnlockData = {
  masterPassword: string;
  masterKeySalt: string;
  masterKeyKdfConfig: KdfConfig;
  masterPasswordHint: string;
};

type V2UserCryptographicState = {
  userKey: UserKey;
  publicKeyEncryptionKeyPair: {
    wrappedPrivateKey: EncString;
    publicKey: string;
    signedPublicKey: string;
  };
  signatureKeyPair: {
    wrappedSigningKey: WrappedSigningKey;
    verifyingKey: VerifyingKey;
  };
  securityState: {
    securityState: SignedSecurityState;
    securityStateVersion: number;
  };
};

/**
 * A token provider that exposes a null access token to the SDK.
 */
class NoopTokenProvider implements TokenProvider {
  constructor() {}

  async get_access_token(): Promise<string | undefined> {
    return undefined;
  }
}

@Injectable({ providedIn: "root" })
export class UserKeyRotationService {
  constructor(
    private apiService: UserKeyRotationApiService,
    private cipherService: CipherService,
    private folderService: FolderService,
    private sendService: SendService,
    private emergencyAccessService: EmergencyAccessService,
    private resetPasswordService: OrganizationUserResetPasswordService,
    private deviceTrustService: DeviceTrustServiceAbstraction,
    private keyService: KeyService,
    private encryptService: EncryptService,
    private syncService: SyncService,
    private webauthnLoginAdminService: WebauthnLoginAdminService,
    private logService: LogService,
    private vaultTimeoutService: VaultTimeoutService,
    private toastService: ToastService,
    private i18nService: I18nService,
    private dialogService: DialogService,
    private configService: ConfigService,
    private cryptoFunctionService: CryptoFunctionService,
    private kdfConfigService: KdfConfigService,
    private sdkClientFactory: SdkClientFactory,
    private securityStateService: SecurityStateService,
  ) {}

  /**
   * Creates a new user key and re-encrypts all required data with the it.
   * @param currentMasterPassword: The current master password
   * @param newMasterPassword: The new master password
   * @param user: The user account
   * @param newMasterPasswordHint: The hint for the new master password
   */
  async rotateUserKeyMasterPasswordAndEncryptedData(
    currentMasterPassword: string,
    newMasterPassword: string,
    user: Account,
    newMasterPasswordHint?: string,
  ): Promise<void> {
    // Key-rotation uses the SDK, so we need to ensure that the SDK is loaded / the WASM initialized.
    await SdkLoadService.Ready;

    const upgradeToV2FeatureFlagEnabled = await this.configService.getFeatureFlag(
      FeatureFlag.EnrollAeadOnKeyRotation,
    );

    this.logService.info("[UserKey Rotation] Starting user key rotation...");

    // Make sure all conditions match - e.g. account state is up to date
    await this.ensureIsAllowedToRotateUserKey();

    // First, the provided organizations and emergency access users need to be verified;
    // this is currently done by providing the user a manual confirmation dialog.
    const { wasTrustDenied, trustedOrganizationPublicKeys, trustedEmergencyAccessUserPublicKeys } =
      await this.verifyTrust(user);
    if (wasTrustDenied) {
      this.logService.info("[Userkey rotation] Trust was denied by user. Aborting!");
      return;
    }

    // Read current cryptographic state / settings
    const {
      masterKeyKdfConfig,
      masterKeySalt,
      currentUserKey,
      currentUserKeyWrappedPrivateKey,
      signingKey,
      securityState,
    } = await this.getCryptographicStateForUser(user);

    // Get new set of keys for the account.
    const { userKey: newUserKey, accountKeysRequest } = await this.getRotatedAccountKeysFlagged(
      currentUserKey,
      currentUserKeyWrappedPrivateKey,
      signingKey,
      securityState,
      user.id,
      masterKeyKdfConfig,
      user.email,
      upgradeToV2FeatureFlagEnabled,
    );

    // Assemble the key rotation request
    const request = new RotateUserAccountKeysRequest(
      await this.getAccountUnlockDataRequest(
        user.id,
        currentUserKey,
        newUserKey,
        {
          masterPassword: newMasterPassword,
          masterKeyKdfConfig,
          masterKeySalt,
          masterPasswordHint: newMasterPasswordHint,
        } as MasterPasswordAuthenticationAndUnlockData,
        trustedEmergencyAccessUserPublicKeys,
        trustedOrganizationPublicKeys,
      ),
      accountKeysRequest,
      await this.getAccountDataRequest(currentUserKey, newUserKey, user),
      await this.makeServerMasterKeyAuthenticationHash(
        currentMasterPassword,
        masterKeyKdfConfig,
        masterKeySalt,
      ),
    );

    this.logService.info("[Userkey rotation] Posting user key rotation request to server");
    await this.apiService.postUserKeyUpdate(request);
    this.logService.info("[Userkey rotation] Userkey rotation request posted to server");

    this.toastService.showToast({
      variant: "success",
      title: this.i18nService.t("rotationCompletedTitle"),
      message: this.i18nService.t("rotationCompletedDesc"),
      timeout: 15000,
    });

    // temporary until userkey can be better verified
    await this.vaultTimeoutService.logOut();
  }

  protected async ensureIsAllowedToRotateUserKey(): Promise<void> {
    if ((await this.syncService.getLastSync()) === null) {
      this.logService.info("[Userkey rotation] Client was never synced. Aborting!");
      throw new Error(
        "The local vault is de-synced and the keys cannot be rotated. Please log out and log back in to resolve this issue.",
      );
    }
  }

  async getRotatedAccountKeysFlagged(
    currentUserKey: UserKey,
    currentUserKeyWrappedPrivateKey: EncString,
    currentSigningKey: WrappedSigningKey | null,
    currentSecurityState: SignedSecurityState | null,
    userId: UserId,
    kdfConfig: KdfConfig,
    email: string,
    v2UpgradeEnabled: boolean,
  ): Promise<{ userKey: UserKey; accountKeysRequest: AccountKeysRequest }> {
    if (v2UpgradeEnabled || !this.isV1User(currentUserKey)) {
      const keys = await this.getNewAccountKeysV2(
        currentUserKey,
        currentUserKeyWrappedPrivateKey,
        currentSigningKey,
        currentSecurityState,
        userId,
        kdfConfig,
        email,
      );
      return {
        userKey: keys.userKey,
        accountKeysRequest: new AccountKeysRequest(
          keys.publicKeyEncryptionKeyPair.wrappedPrivateKey.encryptedString!,
          keys.publicKeyEncryptionKeyPair.publicKey,
          keys.publicKeyEncryptionKeyPair.signedPublicKey,
          keys.signatureKeyPair.wrappedSigningKey,
          keys.signatureKeyPair.verifyingKey,
          keys.signatureKeyPair.verifyingKey.algorithm(),
          keys.securityState.securityState,
          keys.securityState.securityStateVersion,
        ),
      };
    } else {
      const keys = await this.getNewAccountKeysV1(currentUserKey, currentUserKeyWrappedPrivateKey);
      return {
        userKey: keys.userKey,
        accountKeysRequest: new AccountKeysRequest(
          keys.asymmetricEncryptionKeys.wrappedPrivateKey.encryptedString!,
          keys.asymmetricEncryptionKeys.publicKey,
          null, // No signed public key in V1
          null, // No signature key-pair in V1
          null, // No signature key-pair in V1
          null, // No signature key-pair algorithm in V1
          null, // No security state in V1
          null, // No security state in V1
        ),
      };
    }
  }

  protected async getNewAccountKeysV1(
    currentUserKey: UserKey,
    currentUserKeyWrappedPrivateKey: EncString,
  ): Promise<{
    userKey: UserKey;
    asymmetricEncryptionKeys: {
      wrappedPrivateKey: EncString;
      publicKey: string;
    };
  }> {
    // Account key rotation creates a new userkey. All downstream data and keys need to be re-encrypted under this key.
    // Further, this method is used to create new keys in the event that the key hierarchy changes, such as for the
    // creation of a new signing key pair.
    const newUserKey = new SymmetricCryptoKey(
      PureCrypto.make_user_key_aes256_cbc_hmac(),
    ) as UserKey;

    // Re-encrypt the private key with the new user key
    // Rotation of the private key is not supported yet
    const privateKey = await this.encryptService.unwrapDecapsulationKey(
      currentUserKeyWrappedPrivateKey,
      currentUserKey,
    );
    const newUserKeyWrappedPrivateKey = await this.encryptService.wrapDecapsulationKey(
      privateKey,
      newUserKey,
    );
    const publicKey = await this.cryptoFunctionService.rsaExtractPublicKey(privateKey);

    return {
      userKey: newUserKey,
      asymmetricEncryptionKeys: {
        wrappedPrivateKey: newUserKeyWrappedPrivateKey,
        publicKey: Utils.fromBufferToB64(publicKey),
      },
    };
  }

  protected async getNewAccountKeysV2(
    currentUserKey: UserKey,
    currentUserKeyWrappedPrivateKey: EncString,
    currentSigningKey: WrappedSigningKey | null,
    currentSecurityState: SignedSecurityState | null,
    userId: UserId,
    kdfConfig: KdfConfig,
    email: string,
  ): Promise<V2UserCryptographicState> {
    if (this.isV1User(currentUserKey)) {
      return this.upgradeV1UserToV2UserAccountKeys(
        currentUserKey,
        currentUserKeyWrappedPrivateKey,
        userId,
        kdfConfig,
        email,
      );
    } else {
      return this.rotateV2UserAccountKeys(
        currentUserKey,
        currentUserKeyWrappedPrivateKey,
        currentSigningKey,
        currentSecurityState,
        userId,
        kdfConfig,
        email,
      );
    }
  }

  protected async upgradeV1UserToV2UserAccountKeys(
    currentUserKey: UserKey,
    currentUserKeyWrappedPrivateKey: EncString,
    userId: UserId,
    kdfConfig: KdfConfig,
    email: string,
  ): Promise<V2UserCryptographicState> {
    // Initialize an SDK with the current cryptographic state
    const sdk = await this.sdkClientFactory.createSdkClient(new NoopTokenProvider());
    await sdk.crypto().initialize_user_crypto({
      userId: userId,
      kdfParams: kdfConfig.toSdkConfig(),
      email: email,
      privateKey: currentUserKeyWrappedPrivateKey.encryptedString!,
      signingKey: null,
      securityState: null,
      method: {
        decryptedKey: { decrypted_user_key: currentUserKey.toBase64() },
      },
    });

    // Enroll user in v2 crypto
    return this.fromSdkV2KeysToV2UserCryptographicState(
      sdk.crypto().make_keys_for_user_crypto_v2(),
    );
  }

  protected async rotateV2UserAccountKeys(
    currentUserKey: UserKey,
    currentUserKeyWrappedPrivateKey: EncString,
    currentSigningKey: WrappedSigningKey | null,
    currentSecurityState: SignedSecurityState | null,
    userId: UserId,
    kdfConfig: KdfConfig,
    email: string,
  ): Promise<V2UserCryptographicState> {
    // Initialize an SDK with the current cryptographic state
    const sdk = await this.sdkClientFactory.createSdkClient(new NoopTokenProvider());
    await sdk.crypto().initialize_user_crypto({
      userId: userId,
      kdfParams: kdfConfig.toSdkConfig(),
      email: email,
      privateKey: currentUserKeyWrappedPrivateKey.encryptedString!,
      signingKey: currentSigningKey.inner(),
      securityState: currentSecurityState?.securityState,
      method: {
        decryptedKey: { decrypted_user_key: currentUserKey.toBase64() },
      },
    });

    return this.fromSdkV2KeysToV2UserCryptographicState(sdk.crypto().get_v2_rotated_account_keys());
  }

  private fromSdkV2KeysToV2UserCryptographicState(
    response: UserCryptoV2Response,
  ): V2UserCryptographicState {
    return {
      userKey: SymmetricCryptoKey.fromString(response.userKey) as UserKey,
      publicKeyEncryptionKeyPair: {
        wrappedPrivateKey: new EncString(response.privateKey),
        publicKey: response.publicKey,
        signedPublicKey: response.signedPublicKey,
      },
      signatureKeyPair: {
        wrappedSigningKey: new WrappedSigningKey(response.signingKey),
        verifyingKey: new VerifyingKey(response.verifyingKey),
      },
      securityState: {
        securityState: new SignedSecurityState(response.securityState),
        securityStateVersion: response.securityVersion,
      },
    };
  }

  protected async createMasterPasswordUnlockDataRequest(
    userKey: UserKey,
    newUnlockData: MasterPasswordAuthenticationAndUnlockData,
  ): Promise<MasterPasswordUnlockDataRequest> {
    // Decryption via stretched-masterkey-wrapped-userkey
    const newMasterKeyEncryptedUserKey = new EncString(
      PureCrypto.encrypt_user_key_with_master_password(
        userKey.toEncoded(),
        newUnlockData.masterPassword,
        newUnlockData.masterKeySalt,
        newUnlockData.masterKeyKdfConfig.toSdkConfig(),
      ),
    );

    const newMasterKeyAuthenticationHash = await this.makeServerMasterKeyAuthenticationHash(
      newUnlockData.masterPassword,
      newUnlockData.masterKeyKdfConfig,
      newUnlockData.masterKeySalt,
    );

    return new MasterPasswordUnlockDataRequest(
      newUnlockData.masterKeyKdfConfig,
      newUnlockData.masterKeySalt,
      newMasterKeyAuthenticationHash,
      newMasterKeyEncryptedUserKey.encryptedString!,
      newUnlockData.masterPasswordHint,
    );
  }

  protected async getAccountUnlockDataRequest(
    userId: UserId,
    currentUserKey: UserKey,
    newUserKey: UserKey,
    masterPasswordAuthenticationAndUnlockData: MasterPasswordAuthenticationAndUnlockData,
    trustedEmergencyAccessGranteesPublicKeys: Uint8Array[],
    trustedOrganizationPublicKeys: Uint8Array[],
  ): Promise<UnlockDataRequest> {
    // To ensure access; all unlock methods need to be updated and provided the new user key.
    // User unlock methods
    let masterPasswordUnlockData: MasterPasswordUnlockDataRequest;
    if (this.isUserWithMasterPassword(userId)) {
      masterPasswordUnlockData = await this.createMasterPasswordUnlockDataRequest(
        newUserKey,
        masterPasswordAuthenticationAndUnlockData,
      );
    }
    const passkeyUnlockData = await this.webauthnLoginAdminService.getRotatedData(
      currentUserKey,
      newUserKey,
      userId,
    );
    const trustedDeviceUnlockData = await this.deviceTrustService.getRotatedData(
      currentUserKey,
      newUserKey,
      userId,
    );

    // Unlock methods that share to a different user / group
    const emergencyAccessUnlockData = await this.emergencyAccessService.getRotatedData(
      newUserKey,
      trustedEmergencyAccessGranteesPublicKeys,
      userId,
    );
    const organizationAccountRecoveryUnlockData = (await this.resetPasswordService.getRotatedData(
      newUserKey,
      trustedOrganizationPublicKeys,
      userId,
    ))!;

    return new UnlockDataRequest(
      masterPasswordUnlockData!,
      emergencyAccessUnlockData,
      organizationAccountRecoveryUnlockData,
      passkeyUnlockData,
      trustedDeviceUnlockData,
    );
  }

  protected async verifyTrust(user: Account): Promise<{
    wasTrustDenied: boolean;
    trustedOrganizationPublicKeys: Uint8Array[];
    trustedEmergencyAccessUserPublicKeys: Uint8Array[];
  }> {
    // Since currently the joined organizations and emergency access grantees are
    // not signed, manual trust prompts are required, to verify that the server
    // does not inject public keys here.
    //
    // Once signing is implemented, this is the place to also sign the keys and
    // upload the signed trust claims.
    //
    // The flow works in 3 steps:
    // 1. Prepare the user by showing them a dialog telling them they'll be asked
    //    to verify the trust of their organizations and emergency access users.
    // 2. Show the user a dialog for each organization and ask them to verify the trust.
    // 3. Show the user a dialog for each emergency access user and ask them to verify the trust.

    this.logService.info("[Userkey rotation] Verifying trust...");
    const emergencyAccessGrantees = await this.emergencyAccessService.getPublicKeys();
    const organizations = await this.resetPasswordService.getPublicKeys(user.id);

    if (organizations.length > 0 || emergencyAccessGrantees.length > 0) {
      const trustInfoDialog = KeyRotationTrustInfoComponent.open(this.dialogService, {
        numberOfEmergencyAccessUsers: emergencyAccessGrantees.length,
        orgName: organizations.length > 0 ? organizations[0].orgName : undefined,
      });
      if (!(await firstValueFrom(trustInfoDialog.closed))) {
        return {
          wasTrustDenied: true,
          trustedOrganizationPublicKeys: [],
          trustedEmergencyAccessUserPublicKeys: [],
        };
      }
    }

    for (const organization of organizations) {
      const dialogRef = AccountRecoveryTrustComponent.open(this.dialogService, {
        name: organization.orgName,
        orgId: organization.orgId,
        publicKey: organization.publicKey,
      });
      if (!(await firstValueFrom(dialogRef.closed))) {
        return {
          wasTrustDenied: true,
          trustedOrganizationPublicKeys: [],
          trustedEmergencyAccessUserPublicKeys: [],
        };
      }
    }

    for (const details of emergencyAccessGrantees) {
      const dialogRef = EmergencyAccessTrustComponent.open(this.dialogService, {
        name: details.name,
        userId: details.granteeId,
        publicKey: details.publicKey,
      });
      if (!(await firstValueFrom(dialogRef.closed))) {
        return {
          wasTrustDenied: true,
          trustedOrganizationPublicKeys: [],
          trustedEmergencyAccessUserPublicKeys: [],
        };
      }
    }

    this.logService.info(
      "[Userkey rotation] Trust verified for all organizations and emergency access users",
    );
    return {
      wasTrustDenied: false,
      trustedOrganizationPublicKeys: organizations.map((d) => d.publicKey),
      trustedEmergencyAccessUserPublicKeys: emergencyAccessGrantees.map((d) => d.publicKey),
    };
  }

  protected async getAccountDataRequest(
    originalUserKey: UserKey,
    newUnencryptedUserKey: UserKey,
    user: Account,
  ): Promise<UserDataRequest> {
    // Account data is any data owned by the user; this is folders, ciphers (and their attachments), and sends.

    // Currently, ciphers, folders and sends are directly encrypted with the user key. This means
    // that they need to be re-encrypted and re-uploaded. In the future, content-encryption keys
    // (such as cipher keys) will make it so only re-encrypted keys are required.
    const rotatedCiphers = await this.cipherService.getRotatedData(
      originalUserKey,
      newUnencryptedUserKey,
      user.id,
    );
    const rotatedFolders = await this.folderService.getRotatedData(
      originalUserKey,
      newUnencryptedUserKey,
      user.id,
    );
    const rotatedSends = await this.sendService.getRotatedData(
      originalUserKey,
      newUnencryptedUserKey,
      user.id,
    );
    if (rotatedCiphers == null || rotatedFolders == null || rotatedSends == null) {
      this.logService.info("[Userkey rotation] ciphers, folders, or sends are null. Aborting!");
      throw new Error("ciphers, folders, or sends are null");
    }
    return new UserDataRequest(rotatedCiphers, rotatedFolders, rotatedSends);
  }

  /**
   * A V1 user has no signing key, and uses AES256-CBC-HMAC.
   * A V2 user has a signing key, and uses XChaCha20-Poly1305.
   */
  protected isV1User(userKey: UserKey): boolean {
    return userKey.inner().type === EncryptionType.AesCbc256_HmacSha256_B64;
  }

  protected isUserWithMasterPassword(id: UserId): boolean {
    // Currently, key rotation can only be activated when the user has a master password.
    return true;
  }

  protected async makeServerMasterKeyAuthenticationHash(
    masterPassword: string,
    masterKeyKdfConfig: KdfConfig,
    masterKeySalt: string,
  ): Promise<string> {
    const masterKey = await this.keyService.makeMasterKey(
      masterPassword,
      masterKeySalt,
      masterKeyKdfConfig,
    );
    return this.keyService.hashMasterKey(
      masterPassword,
      masterKey,
      HashPurpose.ServerAuthorization,
    );
  }

  async getCryptographicStateForUser(user: Account): Promise<{
    masterKeyKdfConfig: KdfConfig;
    masterKeySalt: string;
    currentUserKey: UserKey;
    currentUserKeyWrappedPrivateKey: EncString;
    signingKey: WrappedSigningKey | null;
    securityState: SignedSecurityState | null;
  }> {
    const masterKeyKdfConfig: KdfConfig = (await this.firstValueFromOrThrow(
      this.kdfConfigService.getKdfConfig$(user.id),
      "KDF config",
    ))!;
    // The masterkey salt used for deriving the masterkey always needs to be trimmed and lowercased.
    const masterKeySalt = user.email.trim().toLowerCase();
    const currentUserKey: UserKey = (await this.firstValueFromOrThrow(
      this.keyService.userKey$(user.id),
      "User key",
    ))!;
    const currentUserKeyWrappedPrivateKey = new EncString(
      (await this.firstValueFromOrThrow(
        this.keyService.userEncryptedPrivateKey$(user.id),
        "User encrypted private key",
      ))!,
    );
    const signingKey = await firstValueFrom(this.keyService.userSigningKey$(user.id));
    const securityState = await firstValueFrom(
      this.securityStateService.accountSecurityState$(user.id),
    );
    return {
      masterKeyKdfConfig,
      masterKeySalt,
      currentUserKey,
      currentUserKeyWrappedPrivateKey,
      signingKey: signingKey ?? null, // Ensure signing key is null if not present
      securityState: securityState ?? null, // Ensure security state is null if not present
    };
  }

  async firstValueFromOrThrow<T>(value: Observable<T>, name: string): Promise<T> {
    const result = await firstValueFrom(value);
    if (result == null) {
      throw new Error(`Failed to get ${name}`);
    }
    return result;
  }
}
