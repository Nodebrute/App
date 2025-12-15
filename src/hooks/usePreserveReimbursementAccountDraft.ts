import {useEffect, useRef} from 'react';
import Onyx, {type Connection} from 'react-native-onyx';
import type {OnyxEntry} from 'react-native-onyx';
import lodashPick from 'lodash/pick';
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

    // Helper function to disconnect Onyx connection
    const disconnectConnection = () => {
        if (connectionRef.current !== null) {
            Onyx.disconnect(connectionRef.current);
            connectionRef.current = null;
        }
    };

    // Helper function to clear preserved draft
    const clearPreservedDraft = () => {
        preservedDraftRef.current = null;
    };

    // Set up Onyx connection to watch for draft being cleared
    useEffect(() => {
        // Only watch if we have preserved draft data
        if (!preservedDraftRef.current) {
            return;
        }

        // Connect to watch for draft changes
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
        // Check if we're coming back online
        if (!prevIsOffline || isOffline || !prevReimbursementAccount) {
            return;
        }

        // Only preserve if we have draft data and valid step
        if (!reimbursementAccountDraft || isEmptyObject(reimbursementAccountDraft) || !currentStep) {
            return;
        }

        // Only preserve for steps that have fields defined
        if (currentStep !== CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT && currentStep !== CONST.BANK_ACCOUNT.STEP.COMPANY && currentStep !== CONST.BANK_ACCOUNT.STEP.REQUESTOR) {
            return;
        }

        const fieldsForStep = getFieldsForStep(currentStep);
        if (fieldsForStep.length === 0) {
            return;
        }

        // Preserve only step-specific fields
        const stepFields = lodashPick(reimbursementAccountDraft, fieldsForStep);
        if (!isEmptyObject(stepFields)) {
            preservedDraftRef.current = {
                data: stepFields,
                step: currentStep,
            };
        }
    }, [prevIsOffline, isOffline, reimbursementAccountDraft, currentStep, prevReimbursementAccount]);

    // Clear preserved draft when step changes
    // This is necessary because:
    // 1. If user navigates away from a step (back/forward), we shouldn't restore old preserved data when they return
    // 2. If user presses Next and data is saved, we shouldn't restore stale preserved data even if draft isn't cleared yet
    // 3. Prevents edge cases where user navigates away before backend clears the draft
    useEffect(() => {
        if (prevCurrentStep && prevCurrentStep !== currentStep && preservedDraftRef.current) {
            clearPreservedDraft();
        }
    }, [prevCurrentStep, currentStep]);

    // Cleanup on unmount - connection cleanup is already handled by the connection useEffect cleanup
    useEffect(() => {
        return () => {
            disconnectConnection();
            clearPreservedDraft();
        };
    }, []);
}

export default usePreserveReimbursementAccountDraft;
