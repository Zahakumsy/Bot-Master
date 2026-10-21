declare module "supra-l1-sdk" {
  export class HexString {
    constructor(value: string);
    toUint8Array(): Uint8Array;
    toString(): string;
  }
  export class SupraAccount {
    constructor(privateKey?: Uint8Array);
    address(): HexString;
  }
  export class SupraClient {
    static init(url: string): Promise<SupraClient>;
    getAccountInfo(address: HexString): Promise<{ sequence_number: bigint | number | string }>;
    createSerializedRawTxObject(
      sender: HexString,
      sequence: bigint,
      moduleAddress: string,
      moduleName: string,
      functionName: string,
      typeArgs: unknown[],
      args: Uint8Array[],
      extra?: { maxGas?: bigint; gasUnitPrice?: bigint },
    ): Promise<Uint8Array>;
    sendTxUsingSerializedRawTransaction(
      sender: SupraAccount,
      serialized: Uint8Array,
      options?: { enableTransactionSimulation?: boolean; enableWaitForTransaction?: boolean },
    ): Promise<{ txHash: string }>;
  }
  export const BCS: {
    bcsSerializeUint64(value: bigint): Uint8Array;
    bcsSerializeBool(value: boolean): Uint8Array;
  };
  export const TxnBuilderTypes: {
    TypeTagParser: new (tag: string) => { parseTypeTag(): unknown };
  };
}
