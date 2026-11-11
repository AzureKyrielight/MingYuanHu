declare module '*?raw' {
  const content: string;
  export default content;
}

declare module 'sm-crypto' {
  export const sm2: {
    /** cipherMode: 0 = C1C2C3（川大统一认证），1 = C1C3C2。 */
    doEncrypt(message: string, publicKeyHex: string, cipherMode?: 0 | 1): string;
    /** 仅测试使用：验证密文能被同一密钥还原。 */
    doDecrypt(cipherHex: string, privateKeyHex: string, cipherMode?: 0 | 1): string;
    generateKeyPairHex(): { publicKey: string; privateKey: string };
  };
}
