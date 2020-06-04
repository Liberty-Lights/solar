import React from "react"
import { Horizon, Operation, Server, Transaction, xdr } from "stellar-sdk"
import { trackError } from "~App/contexts/notifications"
import { Account } from "~App/contexts/accounts"
import { useLiveAccountData } from "~Generic/hooks/stellar-subscriptions"
import { AccountData } from "~Generic/lib/account"
import { createTransaction } from "~Generic/lib/transaction"
import { initializeEditorState, SignersEditorState } from "../lib/editor"

export interface SignersEditorOptions {
  account: Account
  horizon: Server
  sendTransaction: (tx: Transaction) => void
}

export interface SignersUpdate {
  signersToAdd: Horizon.AccountSigner[]
  signersToRemove: Horizon.AccountSigner[]
  weightThreshold: number
}

function createTxOperations(accountData: AccountData, update: SignersUpdate): xdr.Operation[] {
  const operations: xdr.Operation[] = [
    // signer removals before adding, so you can remove and immediately re-add signer
    ...update.signersToRemove.map(signer =>
      Operation.setOptions({
        signer: { ed25519PublicKey: signer.key, weight: 0 }
      })
    ),
    ...update.signersToAdd.map(signer =>
      Operation.setOptions({
        signer: { ed25519PublicKey: signer.key, weight: signer.weight }
      })
    )
  ]

  if (
    update.weightThreshold !== accountData.thresholds.low_threshold &&
    update.weightThreshold !== accountData.thresholds.med_threshold &&
    update.weightThreshold !== accountData.thresholds.high_threshold
  ) {
    operations.push(
      Operation.setOptions({
        lowThreshold: update.weightThreshold,
        medThreshold: update.weightThreshold,
        highThreshold: update.weightThreshold
      })
    )
  }

  return operations
}

export function useSignersEditor(options: SignersEditorOptions) {
  const accountData = useLiveAccountData(options.account.accountID, options.account.testnet)
  const [txCreationPending, setTxCreationPending] = React.useState(false)
  const [_editorState, _setEditorState] = React.useState<SignersEditorState>()

  const initialEditorState = React.useMemo(() => initializeEditorState(accountData), [accountData])
  const editorState = _editorState || initialEditorState

  const setEditorState = React.useCallback(
    (update: SignersEditorState | React.SetStateAction<SignersEditorState>) => {
      if (typeof update === "function") {
        _setEditorState(prev => update(prev || initialEditorState))
      } else {
        _setEditorState(update)
      }
    },
    [_setEditorState, initialEditorState]
  )

  const applyUpdate = async (update: SignersUpdate) => {
    try {
      setTxCreationPending(true)
      const operations = createTxOperations(accountData, update)

      const tx = await createTransaction(operations, {
        accountData,
        horizon: options.horizon,
        walletAccount: options.account
      })

      const submissionPromise = options.sendTransaction(tx)
      setTxCreationPending(false)

      await submissionPromise
    } catch (error) {
      trackError(error)
      setTxCreationPending(false)
    }
  }

  return {
    applyUpdate,
    editorState,
    setEditorState: setEditorState as React.Dispatch<React.SetStateAction<SignersEditorState>>,
    txCreationPending
  }
}
