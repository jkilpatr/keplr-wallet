import { BACKGROUND_PORT, MessageRequester } from "@keplr/router";
import {
  AddLedgerKeyMsg,
  AddMnemonicKeyMsg,
  AddPrivateKeyMsg,
  BIP44HDPath,
  ChangeKeyRingMsg,
  CreateLedgerKeyMsg,
  CreateMnemonicKeyMsg,
  CreatePrivateKeyMsg,
  DeleteKeyRingMsg,
  EnableKeyRingMsg,
  GetIsKeyStoreCoinTypeSetMsg,
  GetKeyRingTypeMsg,
  GetMultiKeyStoreInfoMsg,
  KeyRingStatus,
  LockKeyRingMsg,
  MultiKeyStoreInfoWithSelected,
  RestoreKeyRingMsg,
  SetKeyStoreCoinTypeMsg,
  ShowKeyRingMsg,
  UnlockKeyRingMsg,
} from "@keplr/background";

import { computed, flow, makeObservable, observable, runInAction } from "mobx";

import { Buffer } from "buffer/";
import { InteractionStore } from "./interaction";
import { ChainGetter } from "../common";
import { BIP44 } from "@keplr/types";
import { DeepReadonly } from "utility-types";
import { toGenerator } from "@keplr/common";

export class KeyRingSelectablesStore {
  @observable
  isInitializing: boolean = false;

  @observable
  protected _isKeyStoreCoinTypeSet: boolean = false;

  @observable.ref
  _selectables: {
    path: BIP44;
    bech32Address: string;
  }[] = [];

  constructor(
    protected readonly chainGetter: ChainGetter,
    protected readonly requester: MessageRequester,
    protected readonly chainId: string,
    protected readonly keyRingStore: KeyRingStore
  ) {
    makeObservable(this);

    this.refresh();
  }

  @computed
  get needSelectCoinType(): boolean {
    const chainInfo = this.chainGetter.getChain(this.chainId);
    if (
      !chainInfo.alternativeBIP44s ||
      chainInfo.alternativeBIP44s.length === 0
    ) {
      return false;
    }
    return !this.isInitializing && !this._isKeyStoreCoinTypeSet;
  }

  get selectables(): DeepReadonly<
    {
      path: BIP44;
      bech32Address: string;
    }[]
  > {
    return this._selectables;
  }

  @flow
  *refresh() {
    // No need to set the coin type if the key store type is not mnemonic.
    if (this.keyRingStore.keyRingType !== "mnemonic") {
      this.isInitializing = false;
      this._isKeyStoreCoinTypeSet = true;
      this._selectables = [];

      return;
    }

    this.isInitializing = true;

    const chainInfo = this.chainGetter.getChain(this.chainId);

    const msg = new GetIsKeyStoreCoinTypeSetMsg(this.chainId, [
      chainInfo.bip44,
      ...(chainInfo.alternativeBIP44s ?? []),
    ]);
    const seletables = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );

    if (seletables.length === 0) {
      this._isKeyStoreCoinTypeSet = true;
    } else if (seletables.length === 1) {
      yield this.keyRingStore.setKeyStoreCoinType(
        this.chainId,
        seletables[0].path.coinType
      );
      this._isKeyStoreCoinTypeSet = true;
    } else {
      this._selectables = seletables;
      this._isKeyStoreCoinTypeSet = false;
    }

    this.isInitializing = false;
  }
}

/*
 Actual key ring logic is managed in persistent background. Refer "src/common/message" and "src/background/keyring"
 This store only interact with key ring in persistent background.
 */
export class KeyRingStore {
  @observable
  status: KeyRingStatus = KeyRingStatus.NOTLOADED;

  @observable
  keyRingType: string = "none";

  @observable
  multiKeyStoreInfo: MultiKeyStoreInfoWithSelected = [];

  @observable.shallow
  protected selectablesMap: Map<string, KeyRingSelectablesStore> = new Map();

  constructor(
    protected readonly chainGetter: ChainGetter,
    protected readonly requester: MessageRequester,
    protected readonly interactionStore: InteractionStore
  ) {
    makeObservable(this);

    this.restore();
  }

  @flow
  *createMnemonicKey(
    mnemonic: string,
    password: string,
    meta: Record<string, string>,
    bip44HDPath: BIP44HDPath
  ) {
    const msg = new CreateMnemonicKeyMsg(mnemonic, password, meta, bip44HDPath);
    const result = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );
    this.status = result.status;

    this.keyRingType = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, new GetKeyRingTypeMsg())
    );
  }

  @flow
  *createPrivateKey(
    privateKey: Uint8Array,
    password: string,
    meta: Record<string, string>
  ) {
    const msg = new CreatePrivateKeyMsg(
      Buffer.from(privateKey).toString("hex"),
      password,
      meta
    );
    const result = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );
    this.status = result.status;

    this.keyRingType = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, new GetKeyRingTypeMsg())
    );
  }

  @flow
  *createLedgerKey(
    password: string,
    meta: Record<string, string>,
    bip44HDPath: BIP44HDPath
  ) {
    const msg = new CreateLedgerKeyMsg(password, meta, bip44HDPath);
    const result = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );
    this.status = result.status;

    this.keyRingType = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, new GetKeyRingTypeMsg())
    );
  }

  @flow
  *addMnemonicKey(
    mnemonic: string,
    meta: Record<string, string>,
    bip44HDPath: BIP44HDPath
  ) {
    const msg = new AddMnemonicKeyMsg(mnemonic, meta, bip44HDPath);
    this.multiKeyStoreInfo = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );
  }

  @flow
  *addPrivateKey(privateKey: Uint8Array, meta: Record<string, string>) {
    const msg = new AddPrivateKeyMsg(
      Buffer.from(privateKey).toString("hex"),
      meta
    );
    this.multiKeyStoreInfo = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );
  }

  @flow
  *addLedgerKey(meta: Record<string, string>, bip44HDPath: BIP44HDPath) {
    const msg = new AddLedgerKeyMsg(meta, bip44HDPath);
    this.multiKeyStoreInfo = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );
  }

  @flow
  *changeKeyRing(index: number) {
    const msg = new ChangeKeyRingMsg(index);
    this.multiKeyStoreInfo = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );

    this.keyRingType = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, new GetKeyRingTypeMsg())
    );

    // Emit the key store changed event manually.
    window.dispatchEvent(new Event("keplr_keystorechange"));
    this.selectablesMap.forEach((selectables) => selectables.refresh());
  }

  @flow
  *lock() {
    const msg = new LockKeyRingMsg();
    const result = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );
    this.status = result.status;
  }

  @flow
  *unlock(password: string) {
    const msg = new UnlockKeyRingMsg(password);
    const result = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );
    this.status = result.status;

    // Approve all waiting interaction for the enabling key ring.
    for (const interaction of this.interactionStore.getDatas(
      EnableKeyRingMsg.type()
    )) {
      yield this.interactionStore.approve(
        EnableKeyRingMsg.type(),
        interaction.id,
        {}
      );
    }

    window.dispatchEvent(new Event("keplr_keystoreunlock"));
  }

  @flow
  protected *restore() {
    const msg = new RestoreKeyRingMsg();
    const result = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );
    this.status = result.status;
    this.keyRingType = result.type;
    this.multiKeyStoreInfo = result.multiKeyStoreInfo;
  }

  @flow
  *showKeyRing(index: number, password: string) {
    const msg = new ShowKeyRingMsg(index, password);
    return yield this.requester.sendMessage(BACKGROUND_PORT, msg);
  }

  @flow
  *deleteKeyRing(index: number, password: string) {
    const msg = new DeleteKeyRingMsg(index, password);
    const result = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, msg)
    );
    this.status = result.status;
    this.multiKeyStoreInfo = result.multiKeyStoreInfo;

    // Possibly, key ring can be changed if deleting key store was selected one.
    this.keyRingType = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, new GetKeyRingTypeMsg())
    );
  }

  getKeyStoreSelectables(chainId: string): KeyRingSelectablesStore {
    if (!this.selectablesMap.has(chainId)) {
      runInAction(() => {
        this.selectablesMap.set(
          chainId,
          new KeyRingSelectablesStore(
            this.chainGetter,
            this.requester,
            chainId,
            this
          )
        );
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.selectablesMap.get(chainId)!;
  }

  // Set the coin type to current key store.
  // And, save it, refresh the key store.
  @flow
  *setKeyStoreCoinType(chainId: string, coinType: number) {
    const status = yield* toGenerator(
      this.requester.sendMessage(
        BACKGROUND_PORT,
        new SetKeyStoreCoinTypeMsg(chainId, coinType)
      )
    );

    this.multiKeyStoreInfo = yield* toGenerator(
      this.requester.sendMessage(BACKGROUND_PORT, new GetMultiKeyStoreInfoMsg())
    );

    this.status = status;

    // Emit the key store changed event manually.
    window.dispatchEvent(new Event("keplr_keystorechange"));
    this.selectablesMap.forEach((selectables) => selectables.refresh());
  }
}