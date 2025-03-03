import BigNumber from "big.js"
import nanoid from "nanoid"
import React from "react"
import { Controller, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Asset, Memo, MemoType, Server, Transaction } from "stellar-sdk"
import InputAdornment from "@material-ui/core/InputAdornment"
import TextField from "@material-ui/core/TextField"
import SendIcon from "@material-ui/icons/Send"
import { Account } from "~App/contexts/accounts"
import { AccountRecord, useWellKnownAccounts } from "~Generic/hooks/stellar-ecosystem"
import { useFederationLookup } from "~Generic/hooks/stellar"
import { useIsMobile, RefStateObject } from "~Generic/hooks/userinterface"
import { AccountData } from "~Generic/lib/account"
import { CustomError } from "~Generic/lib/errors"
import { findMatchingBalanceLine, getAccountMinimumBalance, getSpendableBalance } from "~Generic/lib/stellar"
import { isPublicKey, isStellarAddress } from "~Generic/lib/stellar-address"
import { createPaymentOperation, createTransaction, multisigMinimumFee } from "~Generic/lib/transaction"
import { ActionButton, DialogActionsBox } from "~Generic/components/DialogActions"
import AssetSelector from "~Generic/components/AssetSelector"
import { PriceInput, QRReader } from "~Generic/components/FormFields"
import { formatBalance } from "~Generic/lib/balances"
import { HorizontalLayout } from "~Layout/components/Box"
import Portal from "~Generic/components/Portal"

export interface PaymentFormValues {
  amount: string
  asset: Asset
  destination: string
  memoValue: string
}

type ExtendedPaymentFormValues = PaymentFormValues & { memoType: MemoType }

interface MemoMetadata {
  label: string
  placeholder: string
  requiredType: MemoType | undefined
}

function createMemo(memoType: MemoType, memoValue: string) {
  switch (memoType) {
    case "id":
      return Memo.id(memoValue)
    case "text":
      return Memo.text(memoValue)
    default:
      return Memo.none()
  }
}

interface PaymentFormProps {
  accountData: AccountData
  actionsRef: RefStateObject
  onSubmit: (
    formValues: ExtendedPaymentFormValues,
    spendableBalance: BigNumber,
    wellknownAccount?: AccountRecord
  ) => void
  openOrdersCount: number
  testnet: boolean
  trustedAssets: Asset[]
  txCreationPending?: boolean
}

const PaymentForm = React.memo(function PaymentForm(props: PaymentFormProps) {
  const isSmallScreen = useIsMobile()
  const formID = React.useMemo(() => nanoid(), [])
  const { t } = useTranslation()
  const wellknownAccounts = useWellKnownAccounts(props.testnet)

  const [matchingWellknownAccount, setMatchingWellknownAccount] = React.useState<AccountRecord | undefined>(undefined)
  const [memoType, setMemoType] = React.useState<MemoType>("none")
  const [memoMetadata, setMemoMetadata] = React.useState<MemoMetadata>({
    label: t("payment.memo-metadata.label.default"),
    placeholder: t("payment.memo-metadata.placeholder.optional"),
    requiredType: undefined
  })
  const form = useForm<PaymentFormValues>({
    defaultValues: {
      amount: "",
      asset: Asset.native(),
      destination: "",
      memoValue: ""
    }
  })

  const formValues = form.watch()
  const { setValue } = form

  const spendableBalance = getSpendableBalance(
    getAccountMinimumBalance(props.accountData, props.openOrdersCount),
    findMatchingBalanceLine(props.accountData.balances, formValues.asset)
  )

  React.useEffect(() => {
    if (!isPublicKey(formValues.destination) && !isStellarAddress(formValues.destination)) {
      if (matchingWellknownAccount) {
        setMatchingWellknownAccount(undefined)
      }
      return
    }

    const knownAccount = wellknownAccounts.lookup(formValues.destination)
    setMatchingWellknownAccount(knownAccount)

    if (knownAccount && knownAccount.tags.indexOf("exchange") !== -1) {
      const acceptedMemoType = knownAccount.accepts && knownAccount.accepts.memo
      const requiredType = acceptedMemoType === "MEMO_ID" ? "id" : "text"
      setMemoType(requiredType)
      setMemoMetadata({
        label:
          acceptedMemoType === "MEMO_ID" ? t("payment.memo-metadata.label.id") : t("payment.memo-metadata.label.text"),
        placeholder: t("payment.memo-metadata.placeholder.mandatory"),
        requiredType
      })
    } else {
      setMemoType(formValues.memoValue.length === 0 ? "none" : "text")
      setMemoMetadata({
        label: t("payment.memo-metadata.label.default"),
        placeholder: t("payment.memo-metadata.placeholder.optional"),
        requiredType: undefined
      })
    }
  }, [formValues.destination, formValues.memoValue, matchingWellknownAccount, memoType, t, wellknownAccounts])

  const handleFormSubmission = () => {
    props.onSubmit({ memoType, ...form.getValues() }, spendableBalance, matchingWellknownAccount)
  }

  const handleQRScan = React.useCallback(
    (scanResult: string) => {
      const [destination, query] = scanResult.split("?")
      setValue("destination", destination)

      if (!query) {
        return
      }

      const searchParams = new URLSearchParams(query)
      const memoValue = searchParams.get("dt")

      if (memoValue) {
        setMemoType("id")
        setValue("memoValue", memoValue)
      }
    },
    [setValue]
  )

  const qrReaderAdornment = React.useMemo(
    () => (
      <InputAdornment disableTypography position="end">
        <QRReader onScan={handleQRScan} />
      </InputAdornment>
    ),
    [handleQRScan]
  )

  const destinationInput = React.useMemo(
    () => (
      <TextField
        autoFocus={process.env.PLATFORM !== "ios"}
        error={Boolean(form.errors.destination)}
        fullWidth
        inputProps={{
          style: { textOverflow: "ellipsis" }
        }}
        InputProps={{
          endAdornment: qrReaderAdornment
        }}
        inputRef={form.register({
          required: t<string>("payment.validation.no-destination"),
          validate: value =>
            isPublicKey(value) || isStellarAddress(value) || t<string>("payment.validation.invalid-destination")
        })}
        label={form.errors.destination ? form.errors.destination.message : t("payment.inputs.destination.label")}
        margin="normal"
        name="destination"
        onChange={event => setValue("destination", event.target.value.trim())}
        placeholder={t("payment.inputs.destination.placeholder")}
      />
    ),
    [form, qrReaderAdornment, setValue, t]
  )

  const assetSelector = React.useMemo(
    () => (
      <Controller
        as={
          <AssetSelector
            assets={props.accountData.balances}
            disableUnderline
            showXLM
            style={{ alignSelf: "center" }}
            testnet={props.testnet}
            value={formValues.asset}
          />
        }
        control={form.control}
        name="asset"
      />
    ),
    [form, formValues.asset, props.accountData.balances, props.testnet]
  )

  const priceInput = React.useMemo(
    () => (
      <PriceInput
        assetCode={assetSelector}
        error={Boolean(form.errors.amount)}
        inputRef={form.register({
          required: t<string>("payment.validation.no-price"),
          pattern: { value: /^[0-9]+(\.[0-9]+)?$/, message: t<string>("payment.validation.invalid-price") },
          validate: value => BigNumber(value).lte(spendableBalance) || t<string>("payment.validation.not-enough-funds")
        })}
        label={form.errors.amount ? form.errors.amount.message : "Amount"}
        margin="normal"
        name="amount"
        placeholder={t("payment.inputs.price.placeholder", `Max. ${formatBalance(spendableBalance.toString())}`, {
          amount: formatBalance(spendableBalance.toString())
        })}
        style={{
          flexGrow: isSmallScreen ? 1 : undefined,
          marginLeft: 24,
          marginRight: 24,
          minWidth: 230,
          maxWidth: isSmallScreen ? undefined : "60%"
        }}
      />
    ),
    [assetSelector, form, isSmallScreen, spendableBalance, t]
  )

  const memoInput = React.useMemo(
    () => (
      <TextField
        error={Boolean(form.errors.memoValue)}
        inputProps={{ maxLength: 28 }}
        label={form.errors.memoValue ? form.errors.memoValue.message : memoMetadata.label}
        margin="normal"
        name="memoValue"
        inputRef={form.register({
          validate: {
            length: value => value.length <= 28 || t<string>("payment.validation.memo-too-long"),
            memoRequired: value =>
              !memoMetadata.requiredType ||
              !matchingWellknownAccount ||
              value.length > 0 ||
              t<string>(
                "payment.validation.memo-required",
                `Set a memo when sending funds to ${matchingWellknownAccount.name}`,
                {
                  destination: matchingWellknownAccount.name
                }
              ),
            idPattern: value =>
              memoType !== "id" || value.match(/^[0-9]+$/) || t<string>("payment.validation.integer-memo-required")
          }
        })}
        onChange={event => {
          const { value } = event.target
          if (!memoMetadata.requiredType) {
            // only change memo type if no type is required
            const newMemoType = value.length === 0 ? "none" : "text"
            setMemoType(newMemoType)
          }
          setValue("memoValue", value)
        }}
        placeholder={memoMetadata.placeholder}
        style={{
          flexGrow: 1,
          marginLeft: 24,
          marginRight: 24,
          minWidth: 230
        }}
      />
    ),
    [
      form,
      memoType,
      matchingWellknownAccount,
      memoMetadata.label,
      memoMetadata.placeholder,
      memoMetadata.requiredType,
      setValue,
      t
    ]
  )

  const dialogActions = React.useMemo(
    () => (
      <DialogActionsBox desktopStyle={{ marginTop: 64 }}>
        <ActionButton
          form={formID}
          icon={<SendIcon style={{ fontSize: 16 }} />}
          loading={props.txCreationPending}
          onClick={() => undefined}
          type="submit"
        >
          {t("payment.actions.submit")}
        </ActionButton>
      </DialogActionsBox>
    ),
    [formID, props.txCreationPending, t]
  )

  return (
    <form id={formID} noValidate onSubmit={form.handleSubmit(handleFormSubmission)}>
      {destinationInput}
      <HorizontalLayout justifyContent="space-between" alignItems="center" margin="0 -24px" wrap="wrap">
        {priceInput}
        {memoInput}
      </HorizontalLayout>
      <Portal target={props.actionsRef.element}>{dialogActions}</Portal>
    </form>
  )
})

interface Props {
  accountData: AccountData
  actionsRef: RefStateObject
  openOrdersCount: number
  testnet: boolean
  trustedAssets: Asset[]
  txCreationPending?: boolean
  onCancel: () => void
  onSubmit: (createTx: (horizon: Server, account: Account) => Promise<Transaction>) => any
}

function PaymentFormContainer(props: Props) {
  const { lookupFederationRecord } = useFederationLookup()

  const createPaymentTx = async (horizon: Server, account: Account, formValues: ExtendedPaymentFormValues) => {
    const asset = props.trustedAssets.find(trustedAsset => trustedAsset.equals(formValues.asset))
    const federationRecord =
      formValues.destination.indexOf("*") > -1 ? await lookupFederationRecord(formValues.destination) : null
    const destination = federationRecord ? federationRecord.account_id : formValues.destination

    const userMemo = createMemo(formValues.memoType, formValues.memoValue)
    const federationMemo =
      federationRecord && federationRecord.memo && federationRecord.memo_type
        ? new Memo(federationRecord.memo_type as MemoType, federationRecord.memo)
        : Memo.none()

    if (userMemo.type !== "none" && federationMemo.type !== "none") {
      throw CustomError(
        "MemoAlreadySpecifiedError",
        `Cannot set a custom memo. Federation record of ${formValues.destination} already specifies memo.`,
        { destination: formValues.destination }
      )
    }

    const isMultisigTx = props.accountData.signers.length > 1

    const payment = await createPaymentOperation({
      asset: asset || Asset.native(),
      amount: formValues.amount,
      destination,
      horizon
    })
    const tx = await createTransaction([payment], {
      accountData: props.accountData,
      memo: federationMemo.type !== "none" ? federationMemo : userMemo,
      minTransactionFee: isMultisigTx ? multisigMinimumFee : 0,
      horizon,
      walletAccount: account
    })
    return tx
  }

  const submitForm = (formValues: ExtendedPaymentFormValues) => {
    props.onSubmit((horizon, account) => createPaymentTx(horizon, account, formValues))
  }

  return <PaymentForm {...props} onSubmit={submitForm} />
}

export default React.memo(PaymentFormContainer)
