// A real testnet receipt produced by spike/s2-s3-e2e.mjs on 2026-10-09:
// a private P2ID note, built by the sender, committed and later consumed by the target.
// Testnet resets will eventually make the on-chain half of it unavailable.
export const TESTNET_RECEIPT = {
  noteFileB64:
    "CsgDGsUDCpkCCiMIARIYChYKCQkA8yJPMm+iWRIJCYFhJo4wXAp5GAElAADsdBLHAQpECh4IARIYChYKCQkANmSuTSKCdBIJCTEKX+f/yr1MGgASIgogQEIPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASfwoiCiC8HVhvlYLkjYZLVvnoqsN+xPwa9IVxIPJ/bLo8SPrwJBI9EjsKOU1BU1QCAAAEAQMDAAAAAAEAAAAAAAAAgPuAUs9JnIkjUT/hEuKkgSsAVzgZR1mQPhqmyrP3M0raARoaCgkJAKE3W04VvxkKCQlBl+RpQ5XvdAoACgAaKAomCAESIgogAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASpgEKJAoiCiAT2AqJ0Sj9Y218or01xnKre6Hta+n98FP5TnjTr1JAbBIFDU5HAQAYASJ1Cc9/AAAAAAAAEiIKIFhf1UrK9j6SlcZ+68Mn9wnKkrLdEBYi/vrDlc/2oB1JEiIKIDJW8KEt1Tc7GH81Iyf4Bsbfp56ZlCiZOLT/jcl0H7A7EiIKIARvtGvfUvaS0+mMHEdpyuXRndYwV7mM2GknA4QjXyC2",
  noteId: "0x13d80a89d128fd636d7ca2bd35c672ab7ba1ed6be9fdf053f94e78d3af52406c",
  sender: "0x790a5c308e26618159a26f324f22f3",
  recipient: "0x74ef954369e4974119bf154e5b37a1",
  faucetId: "0x4cbdcaffe75f0a317482224dae6436",
  amount: 1_000_000n,
  inclusionBlock: 83790,
  spentAt: 83793,
  txId: "0xbe24060c7ec9849e06ce6257660a9dbe5791aba6d004f8a7cb07d2ffd0d0c424",
} as const;
