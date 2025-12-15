import lodashPick from 'lodash/pick';
import {useEffect, useRef} from 'react';
import Onyx, {type Connection} from 'react-native-onyx';
import type {OnyxEntry} from 'react-native-onyx';
import useNetwork from '@hooks/useNetwork';
import usePrevious from '@hooks/usePrevious';
import getFieldsForStep from '@pages/ReimbursementAccount/USD/utils/getFieldsForStep';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {ReimbursementAccountForm} from '@src/types/form';
import type {ReimbursementAccountStep} from '@src/types/onyx/ReimbursementAccount';
import type ReimbursementAccount from '@src/types/onyx/ReimbursementAccount';
import {isEmptyObject} from '@src/types/utils/EmptyObject';

type PreservedDraft = {
    data: Partial<ReimbursementAccountForm>;
    step: ReimbursementAccountStep;
};

/**
 * Custom hook that automatically preserves and restores reimbursement account draft
 * when coming back online. Uses Onyx.connectWithoutView to reactively handle draft clearing.
 *
 * This hook:
 * 1. Preserves step-specific draft fields when going offline->online
 * 2. Automatically restores them when backend clears the draft
 * 3. Clears preserved data when navigating to different steps
 * 4. Cleans up on unmount
 */
function usePreserveReimbursementAccountDraft(
    reimbursementAccount: OnyxEntry<ReimbursementAccount>,
    reimbursementAccountDraft: OnyxEntry<ReimbursementAccountForm>,
    currentStep: ReimbursementAccountStep,
) {
    const {isOffline} = useNetwork();
    const prevIsOffline = usePrevious(isOffline);
    const prevReimbursementAccount = usePrevious(reimbursementAccount);
    const prevCurrentStep = usePrevious(currentStep);
    const preservedDraftRef = useRef<PreservedDraft | null>(null);
    const connectionRef = useRef<Connection | null>(null);

    const disconnectConnection = () => {
        if (connectionRef.current !== null) {
            Onyx.disconnect(connectionRef.current);
            connectionRef.current = null;
        }
    };

    const clearPreservedDraft = () => {
        preservedDraftRef.current = null;
    };
    useEffect(() => {
        if (!preservedDraftRef.current) {
            return;
        }

        const connection = Onyx.connectWithoutView({
            key: ONYXKEYS.FORMS.REIMBURSEMENT_ACCOUNT_FORM_DRAFT,
            callback: (draft) => {
                // If draft is cleared (null or empty) and we have preserved data for current step
                if ((!draft || isEmptyObject(draft)) && preservedDraftRef.current && preservedDraftRef.current.step === currentStep && reimbursementAccount?.isLoading === false) {
                    // Restore the preserved draft
                    Onyx.merge(ONYXKEYS.FORMS.REIMBURSEMENT_ACCOUNT_FORM_DRAFT, preservedDraftRef.current.data);
                    // Clear preserved data after restoring
                    clearPreservedDraft();
                }
            },
        });

        connectionRef.current = connection;

        return disconnectConnection;
    }, [currentStep, reimbursementAccount?.isLoading]);

    // Preserve draft when coming back online
    useEffect(() => {
        if (!prevIsOffline || isOffline || !prevReimbursementAccount) {
            return;
        }

        if (!reimbursementAccountDraft || isEmptyObject(reimbursementAccountDraft) || !currentStep) {
            return;
        }

        if (currentStep !== CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT && currentStep !== CONST.BANK_ACCOUNT.STEP.COMPANY && currentStep !== CONST.BANK_ACCOUNT.STEP.REQUESTOR) {
            return;
        }

        const fieldsForStep = getFieldsForStep(currentStep);
        if (fieldsForStep.length === 0) {
            return;
        }

        const stepFields = lodashPick(reimbursementAccountDraft, fieldsForStep);
        if (!isEmptyObject(stepFields)) {
            preservedDraftRef.current = {
                data: stepFields,
                step: currentStep,
            };
        }
    }, [prevIsOffline, isOffline, reimbursementAccountDraft, currentStep, prevReimbursementAccount]);

    // Clear preserved draft when step changes

    useEffect(() => {
        if (prevCurrentStep && prevCurrentStep !== currentStep && preservedDraftRef.current) {
            clearPreservedDraft();
        }
    }, [prevCurrentStep, currentStep]);

    useEffect(() => {
        return () => {
            disconnectConnection();
            clearPreservedDraft();
        };
    }, []);
}

export default usePreserveReimbursementAccountDraft;
