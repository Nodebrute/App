import cloneDeep from 'lodash/cloneDeep';
import type {OnyxCollection} from 'react-native-onyx';
import type {ValueOf} from 'type-fest';
import type {AdvancedFiltersKeys, ASTNode, QueryFilter, QueryFilters, SearchColumnType, SearchQueryJSON, SearchQueryString, SearchStatus, SortOrder} from '@components/Search/types';
import ChatListItem from '@components/SelectionList/ChatListItem';
import ReportListItem from '@components/SelectionList/Search/ReportListItem';
import TransactionListItem from '@components/SelectionList/Search/TransactionListItem';
import type {ListItem, ReportActionListItemType, ReportListItemType, TransactionListItemType} from '@components/SelectionList/types';
import * as Expensicons from '@src/components/Icon/Expensicons';
import CONST from '@src/CONST';
import type {TranslationPaths} from '@src/languages/types';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import type {SearchAdvancedFiltersForm} from '@src/types/form';
import FILTER_KEYS from '@src/types/form/SearchAdvancedFiltersForm';
import type * as OnyxTypes from '@src/types/onyx';
import type SearchResults from '@src/types/onyx/SearchResults';
import type {ListItemDataType, ListItemType, SearchDataTypes, SearchPersonalDetails, SearchReport, SearchTransaction} from '@src/types/onyx/SearchResults';
import * as CurrencyUtils from './CurrencyUtils';
import DateUtils from './DateUtils';
import {translateLocal} from './Localize';
import {validateAmount} from './MoneyRequestUtils';
import Navigation from './Navigation/Navigation';
import * as PersonalDetailsUtils from './PersonalDetailsUtils';
import {getTagNamesFromTagsLists} from './PolicyUtils';
import * as ReportActionsUtils from './ReportActionsUtils';
import * as ReportUtils from './ReportUtils';
import * as searchParser from './SearchParser/searchParser';
import * as TransactionUtils from './TransactionUtils';
import * as UserUtils from './UserUtils';
import * as ValidationUtils from './ValidationUtils';

type FilterKeys = keyof typeof CONST.SEARCH.SYNTAX_FILTER_KEYS;

const columnNamesToSortingProperty = {
    [CONST.SEARCH.TABLE_COLUMNS.TO]: 'formattedTo' as const,
    [CONST.SEARCH.TABLE_COLUMNS.FROM]: 'formattedFrom' as const,
    [CONST.SEARCH.TABLE_COLUMNS.DATE]: 'date' as const,
    [CONST.SEARCH.TABLE_COLUMNS.TAG]: 'tag' as const,
    [CONST.SEARCH.TABLE_COLUMNS.MERCHANT]: 'formattedMerchant' as const,
    [CONST.SEARCH.TABLE_COLUMNS.TOTAL_AMOUNT]: 'formattedTotal' as const,
    [CONST.SEARCH.TABLE_COLUMNS.CATEGORY]: 'category' as const,
    [CONST.SEARCH.TABLE_COLUMNS.TYPE]: 'transactionType' as const,
    [CONST.SEARCH.TABLE_COLUMNS.ACTION]: 'action' as const,
    [CONST.SEARCH.TABLE_COLUMNS.DESCRIPTION]: 'comment' as const,
    [CONST.SEARCH.TABLE_COLUMNS.TAX_AMOUNT]: null,
    [CONST.SEARCH.TABLE_COLUMNS.RECEIPT]: null,
};

// This map contains signs with spaces that match each operator
const operatorToSignMap = {
    [CONST.SEARCH.SYNTAX_OPERATORS.EQUAL_TO]: ':' as const,
    [CONST.SEARCH.SYNTAX_OPERATORS.LOWER_THAN]: '<' as const,
    [CONST.SEARCH.SYNTAX_OPERATORS.LOWER_THAN_OR_EQUAL_TO]: '<=' as const,
    [CONST.SEARCH.SYNTAX_OPERATORS.GREATER_THAN]: '>' as const,
    [CONST.SEARCH.SYNTAX_OPERATORS.GREATER_THAN_OR_EQUAL_TO]: '>=' as const,
    [CONST.SEARCH.SYNTAX_OPERATORS.NOT_EQUAL_TO]: '!=' as const,
    [CONST.SEARCH.SYNTAX_OPERATORS.AND]: ',' as const,
    [CONST.SEARCH.SYNTAX_OPERATORS.OR]: ' ' as const,
};

const emptyPersonalDetails = {
    accountID: CONST.REPORT.OWNER_ACCOUNT_ID_FAKE,
    avatar: '',
    displayName: undefined,
    login: undefined,
};
/* Search list and results related */

/**
 * @private
 */
function getTransactionItemCommonFormattedProperties(
    transactionItem: SearchTransaction,
    from: SearchPersonalDetails,
    to: SearchPersonalDetails,
): Pick<TransactionListItemType, 'formattedFrom' | 'formattedTo' | 'formattedTotal' | 'formattedMerchant' | 'date'> {
    const isExpenseReport = transactionItem.reportType === CONST.REPORT.TYPE.EXPENSE;

    const formattedFrom = from?.displayName ?? from?.login ?? '';
    const formattedTo = to?.displayName ?? to?.login ?? '';
    const formattedTotal = TransactionUtils.getAmount(transactionItem, isExpenseReport);
    const date = transactionItem?.modifiedCreated ? transactionItem.modifiedCreated : transactionItem?.created;
    const merchant = TransactionUtils.getMerchant(transactionItem);
    const formattedMerchant = merchant === CONST.TRANSACTION.PARTIAL_TRANSACTION_MERCHANT || merchant === CONST.TRANSACTION.DEFAULT_MERCHANT ? '' : merchant;

    return {
        formattedFrom,
        formattedTo,
        date,
        formattedTotal,
        formattedMerchant,
    };
}

type ReportKey = `${typeof ONYXKEYS.COLLECTION.REPORT}${string}`;

type TransactionKey = `${typeof ONYXKEYS.COLLECTION.TRANSACTION}${string}`;

type ReportActionKey = `${typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS}${string}`;

function isReportEntry(key: string): key is ReportKey {
    return key.startsWith(ONYXKEYS.COLLECTION.REPORT);
}

function isTransactionEntry(key: string): key is TransactionKey {
    return key.startsWith(ONYXKEYS.COLLECTION.TRANSACTION);
}

function isReportActionEntry(key: string): key is ReportActionKey {
    return key.startsWith(ONYXKEYS.COLLECTION.REPORT_ACTIONS);
}

function getShouldShowMerchant(data: OnyxTypes.SearchResults['data']): boolean {
    return Object.keys(data).some((key) => {
        if (isTransactionEntry(key)) {
            const item = data[key];
            const merchant = item.modifiedMerchant ? item.modifiedMerchant : item.merchant ?? '';
            return merchant !== '' && merchant !== CONST.TRANSACTION.PARTIAL_TRANSACTION_MERCHANT && merchant !== CONST.TRANSACTION.DEFAULT_MERCHANT;
        }
        return false;
    });
}

const currentYear = new Date().getFullYear();

function isReportListItemType(item: ListItem): item is ReportListItemType {
    return 'transactions' in item;
}

function isTransactionListItemType(item: TransactionListItemType | ReportListItemType | ReportActionListItemType): item is TransactionListItemType {
    const transactionListItem = item as TransactionListItemType;
    return transactionListItem.transactionID !== undefined;
}

function isReportActionListItemType(item: TransactionListItemType | ReportListItemType | ReportActionListItemType): item is ReportActionListItemType {
    const reportActionListItem = item as ReportActionListItemType;
    return reportActionListItem.reportActionID !== undefined;
}

function shouldShowYear(data: TransactionListItemType[] | ReportListItemType[] | OnyxTypes.SearchResults['data']): boolean {
    if (Array.isArray(data)) {
        return data.some((item: TransactionListItemType | ReportListItemType) => {
            if (isReportListItemType(item)) {
                // If the item is a ReportListItemType, iterate over its transactions and check them
                return item.transactions.some((transaction) => {
                    const transactionYear = new Date(TransactionUtils.getCreated(transaction)).getFullYear();
                    return transactionYear !== currentYear;
                });
            }

            const createdYear = new Date(item?.modifiedCreated ? item.modifiedCreated : item?.created || '').getFullYear();
            return createdYear !== currentYear;
        });
    }

    for (const key in data) {
        if (isTransactionEntry(key)) {
            const item = data[key];
            const date = TransactionUtils.getCreated(item);

            if (DateUtils.doesDateBelongToAPastYear(date)) {
                return true;
            }
        } else if (isReportActionEntry(key)) {
            const item = data[key];
            for (const action of Object.values(item)) {
                const date = action.created;

                if (DateUtils.doesDateBelongToAPastYear(date)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function getTransactionsSections(data: OnyxTypes.SearchResults['data'], metadata: OnyxTypes.SearchResults['search']): TransactionListItemType[] {
    const shouldShowMerchant = getShouldShowMerchant(data);

    const doesDataContainAPastYearTransaction = shouldShowYear(data);

    return Object.keys(data)
        .filter(isTransactionEntry)
        .map((key) => {
            const transactionItem = data[key];
            const from = data.personalDetailsList?.[transactionItem.accountID];
            const to = transactionItem.managerID ? data.personalDetailsList?.[transactionItem.managerID] : emptyPersonalDetails;

            const {formattedFrom, formattedTo, formattedTotal, formattedMerchant, date} = getTransactionItemCommonFormattedProperties(transactionItem, from, to);

            return {
                ...transactionItem,
                from,
                to,
                formattedFrom,
                formattedTo,
                formattedTotal,
                formattedMerchant,
                date,
                shouldShowMerchant,
                shouldShowCategory: metadata?.columnsToShow?.shouldShowCategoryColumn,
                shouldShowTag: metadata?.columnsToShow?.shouldShowTagColumn,
                shouldShowTax: metadata?.columnsToShow?.shouldShowTaxColumn,
                keyForList: transactionItem.transactionID,
                shouldShowYear: doesDataContainAPastYearTransaction,
            };
        });
}

function getReportActionsSections(data: OnyxTypes.SearchResults['data']): ReportActionListItemType[] {
    const reportActionItems: ReportActionListItemType[] = [];
    for (const key in data) {
        if (isReportActionEntry(key)) {
            const reportActions = data[key];
            for (const reportAction of Object.values(reportActions)) {
                const from = data.personalDetailsList?.[reportAction.accountID];
                if (ReportActionsUtils.isDeletedAction(reportAction)) {
                    // eslint-disable-next-line no-continue
                    continue;
                }
                reportActionItems.push({
                    ...reportAction,
                    from,
                    formattedFrom: from?.displayName ?? from?.login ?? '',
                    date: reportAction.created,
                    keyForList: reportAction.reportActionID,
                });
            }
        }
    }
    return reportActionItems;
}

function getIOUReportName(data: OnyxTypes.SearchResults['data'], reportItem: SearchReport) {
    const payerPersonalDetails = reportItem.managerID ? data.personalDetailsList?.[reportItem.managerID] : emptyPersonalDetails;
    const payerName = payerPersonalDetails?.displayName ?? payerPersonalDetails?.login ?? translateLocal('common.hidden');
    const formattedAmount = CurrencyUtils.convertToDisplayString(reportItem.total ?? 0, reportItem.currency ?? CONST.CURRENCY.USD);
    if (reportItem.action === CONST.SEARCH.ACTION_TYPES.VIEW) {
        return translateLocal('iou.payerOwesAmount', {
            payer: payerName,
            amount: formattedAmount,
        });
    }

    if (reportItem.action === CONST.SEARCH.ACTION_TYPES.PAID) {
        return translateLocal('iou.payerPaidAmount', {
            payer: payerName,
            amount: formattedAmount,
        });
    }

    return reportItem.reportName;
}

function getReportSections(data: OnyxTypes.SearchResults['data'], metadata: OnyxTypes.SearchResults['search']): ReportListItemType[] {
    const shouldShowMerchant = getShouldShowMerchant(data);

    const doesDataContainAPastYearTransaction = shouldShowYear(data);

    const reportIDToTransactions: Record<string, ReportListItemType> = {};
    for (const key in data) {
        if (isReportEntry(key)) {
            const reportItem = {...data[key]};
            const reportKey = `${ONYXKEYS.COLLECTION.REPORT}${reportItem.reportID}`;
            const transactions = reportIDToTransactions[reportKey]?.transactions ?? [];
            const isIOUReport = reportItem.type === CONST.REPORT.TYPE.IOU;

            reportIDToTransactions[reportKey] = {
                ...reportItem,
                keyForList: reportItem.reportID,
                from: data.personalDetailsList?.[reportItem.accountID ?? -1],
                to: reportItem.managerID ? data.personalDetailsList?.[reportItem.managerID] : emptyPersonalDetails,
                transactions,
                reportName: isIOUReport ? getIOUReportName(data, reportItem) : reportItem.reportName,
            };
        } else if (isTransactionEntry(key)) {
            const transactionItem = {...data[key]};
            const reportKey = `${ONYXKEYS.COLLECTION.REPORT}${transactionItem.reportID}`;

            const from = data.personalDetailsList?.[transactionItem.accountID];
            const to = transactionItem.managerID ? data.personalDetailsList?.[transactionItem.managerID] : emptyPersonalDetails;

            const {formattedFrom, formattedTo, formattedTotal, formattedMerchant, date} = getTransactionItemCommonFormattedProperties(transactionItem, from, to);

            const transaction = {
                ...transactionItem,
                from,
                to,
                formattedFrom,
                formattedTo,
                formattedTotal,
                formattedMerchant,
                date,
                shouldShowMerchant,
                shouldShowCategory: metadata?.columnsToShow?.shouldShowCategoryColumn,
                shouldShowTag: metadata?.columnsToShow?.shouldShowTagColumn,
                shouldShowTax: metadata?.columnsToShow?.shouldShowTaxColumn,
                keyForList: transactionItem.transactionID,
                shouldShowYear: doesDataContainAPastYearTransaction,
            };
            if (reportIDToTransactions[reportKey]?.transactions) {
                reportIDToTransactions[reportKey].transactions.push(transaction);
            } else if (reportIDToTransactions[reportKey]) {
                reportIDToTransactions[reportKey].transactions = [transaction];
            }
        }
    }

    return Object.values(reportIDToTransactions);
}

function getListItem(type: SearchDataTypes, status: SearchStatus): ListItemType<typeof type, typeof status> {
    if (type === CONST.SEARCH.DATA_TYPES.CHAT) {
        return ChatListItem;
    }
    if (status === CONST.SEARCH.STATUS.EXPENSE.ALL) {
        return TransactionListItem;
    }
    return ReportListItem;
}

function getSections(type: SearchDataTypes, status: SearchStatus, data: OnyxTypes.SearchResults['data'], metadata: OnyxTypes.SearchResults['search']) {
    if (type === CONST.SEARCH.DATA_TYPES.CHAT) {
        return getReportActionsSections(data);
    }
    if (status === CONST.SEARCH.STATUS.EXPENSE.ALL) {
        return getTransactionsSections(data, metadata);
    }
    return getReportSections(data, metadata);
}

function getSortedSections(type: SearchDataTypes, status: SearchStatus, data: ListItemDataType<typeof type, typeof status>, sortBy?: SearchColumnType, sortOrder?: SortOrder) {
    if (type === CONST.SEARCH.DATA_TYPES.CHAT) {
        return getSortedReportActionData(data as ReportActionListItemType[]);
    }
    if (status === CONST.SEARCH.STATUS.EXPENSE.ALL) {
        return getSortedTransactionData(data as TransactionListItemType[], sortBy, sortOrder);
    }
    return getSortedReportData(data as ReportListItemType[]);
}

function getSortedTransactionData(data: TransactionListItemType[], sortBy?: SearchColumnType, sortOrder?: SortOrder) {
    if (!sortBy || !sortOrder) {
        return data;
    }

    const sortingProperty = columnNamesToSortingProperty[sortBy];

    if (!sortingProperty) {
        return data;
    }

    return data.sort((a, b) => {
        const aValue = sortingProperty === 'comment' ? a.comment?.comment : a[sortingProperty];
        const bValue = sortingProperty === 'comment' ? b.comment?.comment : b[sortingProperty];

        if (aValue === undefined || bValue === undefined) {
            return 0;
        }

        // We are guaranteed that both a and b will be string or number at the same time
        if (typeof aValue === 'string' && typeof bValue === 'string') {
            return sortOrder === CONST.SEARCH.SORT_ORDER.ASC ? aValue.toLowerCase().localeCompare(bValue) : bValue.toLowerCase().localeCompare(aValue);
        }

        const aNum = aValue as number;
        const bNum = bValue as number;

        return sortOrder === CONST.SEARCH.SORT_ORDER.ASC ? aNum - bNum : bNum - aNum;
    });
}

function getReportNewestTransactionDate(report: ReportListItemType) {
    return report.transactions?.reduce((max, curr) => (curr.modifiedCreated ?? curr.created > (max?.created ?? '') ? curr : max), report.transactions.at(0))?.created;
}

function getSortedReportData(data: ReportListItemType[]) {
    return data.sort((a, b) => {
        const aNewestTransaction = getReportNewestTransactionDate(a);
        const bNewestTransaction = getReportNewestTransactionDate(b);

        if (!aNewestTransaction || !bNewestTransaction) {
            return 0;
        }

        return bNewestTransaction.toLowerCase().localeCompare(aNewestTransaction);
    });
}

function getSortedReportActionData(data: ReportActionListItemType[]) {
    return data.sort((a, b) => {
        const aValue = a?.created;
        const bValue = b?.created;

        if (aValue === undefined || bValue === undefined) {
            return 0;
        }

        return bValue.toLowerCase().localeCompare(aValue);
    });
}

function isSearchResultsEmpty(searchResults: SearchResults) {
    return !Object.keys(searchResults?.data).some((key) => key.startsWith(ONYXKEYS.COLLECTION.TRANSACTION));
}

function getQueryHash(query: SearchQueryJSON): number {
    let orderedQuery = '';
    if (query.policyID) {
        orderedQuery += `${CONST.SEARCH.SYNTAX_ROOT_KEYS.POLICY_ID}:${query.policyID} `;
    }
    orderedQuery += `${CONST.SEARCH.SYNTAX_ROOT_KEYS.TYPE}:${query.type}`;
    orderedQuery += ` ${CONST.SEARCH.SYNTAX_ROOT_KEYS.STATUS}:${query.status}`;
    orderedQuery += ` ${CONST.SEARCH.SYNTAX_ROOT_KEYS.SORT_BY}:${query.sortBy}`;
    orderedQuery += ` ${CONST.SEARCH.SYNTAX_ROOT_KEYS.SORT_ORDER}:${query.sortOrder}`;

    Object.keys(query.flatFilters)
        .sort()
        .forEach((key) => {
            const filterValues = query.flatFilters?.[key as AdvancedFiltersKeys];
            const sortedFilterValues = filterValues?.sort((queryFilter1, queryFilter2) => {
                if (queryFilter1.value > queryFilter2.value) {
                    return 1;
                }
                return -1;
            });
            orderedQuery += ` ${buildFilterString(key, sortedFilterValues ?? [])}`;
        });

    return UserUtils.hashText(orderedQuery, 2 ** 32);
}

function getExpenseTypeTranslationKey(expenseType: ValueOf<typeof CONST.SEARCH.TRANSACTION_TYPE>): TranslationPaths {
    // eslint-disable-next-line default-case
    switch (expenseType) {
        case CONST.SEARCH.TRANSACTION_TYPE.DISTANCE:
            return 'common.distance';
        case CONST.SEARCH.TRANSACTION_TYPE.CARD:
            return 'common.card';
        case CONST.SEARCH.TRANSACTION_TYPE.CASH:
            return 'iou.cash';
    }
}

/* Search query related */

/**
 * Update string query with all the default params that are set by parser
 */
function normalizeQuery(query: string) {
    const normalizedQueryJSON = buildSearchQueryJSON(query);
    return buildSearchQueryString(normalizedQueryJSON);
}

/**
 * @private
 * returns Date filter query string part, which needs special logic
 */
function buildDateFilterQuery(filterValues: Partial<SearchAdvancedFiltersForm>) {
    const dateBefore = filterValues[FILTER_KEYS.DATE_BEFORE];
    const dateAfter = filterValues[FILTER_KEYS.DATE_AFTER];

    let dateFilter = '';
    if (dateBefore) {
        dateFilter += `${CONST.SEARCH.SYNTAX_FILTER_KEYS.DATE}<${dateBefore}`;
    }
    if (dateBefore && dateAfter) {
        dateFilter += ' ';
    }
    if (dateAfter) {
        dateFilter += `${CONST.SEARCH.SYNTAX_FILTER_KEYS.DATE}>${dateAfter}`;
    }

    return dateFilter;
}

/**
 * @private
 * returns Date filter query string part, which needs special logic
 */
function buildAmountFilterQuery(filterValues: Partial<SearchAdvancedFiltersForm>) {
    const lessThan = filterValues[FILTER_KEYS.LESS_THAN];
    const greaterThan = filterValues[FILTER_KEYS.GREATER_THAN];

    let amountFilter = '';
    if (greaterThan) {
        amountFilter += `${CONST.SEARCH.SYNTAX_FILTER_KEYS.AMOUNT}>${greaterThan}`;
    }
    if (lessThan && greaterThan) {
        amountFilter += ' ';
    }
    if (lessThan) {
        amountFilter += `${CONST.SEARCH.SYNTAX_FILTER_KEYS.AMOUNT}<${lessThan}`;
    }

    return amountFilter;
}

function sanitizeString(str: string) {
    const regexp = /[^A-Za-z0-9_@./#&+\-\\';,"]/g;
    if (regexp.test(str)) {
        return `"${str}"`;
    }
    return str;
}

/**
 * @private
 * traverses the AST and returns filters as a QueryFilters object
 */
function getFilters(queryJSON: SearchQueryJSON) {
    const filters = {} as QueryFilters;
    const filterKeys = Object.values(CONST.SEARCH.SYNTAX_FILTER_KEYS);

    function traverse(node: ASTNode) {
        if (!node.operator) {
            return;
        }

        if (typeof node?.left === 'object' && node.left) {
            traverse(node.left);
        }

        if (typeof node?.right === 'object' && node.right && !Array.isArray(node.right)) {
            traverse(node.right);
        }

        const nodeKey = node.left as ValueOf<typeof CONST.SEARCH.SYNTAX_FILTER_KEYS>;
        if (!filterKeys.includes(nodeKey)) {
            return;
        }

        if (!filters[nodeKey]) {
            filters[nodeKey] = [];
        }

        // the "?? []" is added only for typescript because otherwise TS throws an error, in newer TS versions this should be fixed
        const filterArray = filters[nodeKey] ?? [];
        if (!Array.isArray(node.right)) {
            filterArray.push({
                operator: node.operator,
                value: node.right as string | number,
            });
        } else {
            node.right.forEach((element) => {
                filterArray.push({
                    operator: node.operator,
                    value: element as string | number,
                });
            });
        }
    }

    if (queryJSON.filters) {
        traverse(queryJSON.filters);
    }

    return filters;
}

function buildSearchQueryJSON(query: SearchQueryString) {
    try {
        const result = searchParser.parse(query) as SearchQueryJSON;
        const flatFilters = getFilters(result);

        // Add the full input and hash to the results
        result.inputQuery = query;
        result.flatFilters = flatFilters;
        result.hash = getQueryHash(result);
        return result;
    } catch (e) {
        console.error(`Error when parsing SearchQuery: "${query}"`, e);
    }
}

function buildSearchQueryString(queryJSON?: SearchQueryJSON) {
    const queryParts: string[] = [];
    const defaultQueryJSON = buildSearchQueryJSON('');

    for (const [, key] of Object.entries(CONST.SEARCH.SYNTAX_ROOT_KEYS)) {
        const existingFieldValue = queryJSON?.[key];
        const queryFieldValue = existingFieldValue ?? defaultQueryJSON?.[key];

        if (queryFieldValue) {
            queryParts.push(`${key}:${queryFieldValue}`);
        }
    }

    if (!queryJSON) {
        return queryParts.join(' ');
    }

    const filters = queryJSON.flatFilters;

    for (const [, filterKey] of Object.entries(CONST.SEARCH.SYNTAX_FILTER_KEYS)) {
        const queryFilter = filters[filterKey];

        if (queryFilter) {
            const filterValueString = buildFilterString(filterKey, queryFilter);
            queryParts.push(filterValueString);
        }
    }

    return queryParts.join(' ');
}

/**
 * Given object with chosen search filters builds correct query string from them
 */
function buildQueryStringFromFilterFormValues(filterValues: Partial<SearchAdvancedFiltersForm>) {
    // We separate type and status filters from other filters to maintain hashes consistency for saved searches
    const {type, status, policyID, ...otherFilters} = filterValues;
    const filtersString: string[] = [];

    filtersString.push(`${CONST.SEARCH.SYNTAX_ROOT_KEYS.SORT_BY}:${CONST.SEARCH.TABLE_COLUMNS.DATE}`);
    filtersString.push(`${CONST.SEARCH.SYNTAX_ROOT_KEYS.SORT_ORDER}:${CONST.SEARCH.SORT_ORDER.DESC}`);

    if (type) {
        const sanitizedType = sanitizeString(type);
        filtersString.push(`${CONST.SEARCH.SYNTAX_ROOT_KEYS.TYPE}:${sanitizedType}`);
    }

    if (status) {
        const sanitizedStatus = sanitizeString(status);
        filtersString.push(`${CONST.SEARCH.SYNTAX_ROOT_KEYS.STATUS}:${sanitizedStatus}`);
    }

    if (policyID) {
        const sanitizedPolicyID = sanitizeString(policyID);
        filtersString.push(`${CONST.SEARCH.SYNTAX_ROOT_KEYS.POLICY_ID}:${sanitizedPolicyID}`);
    }

    const mappedFilters = Object.entries(otherFilters)
        .map(([filterKey, filterValue]) => {
            if ((filterKey === FILTER_KEYS.MERCHANT || filterKey === FILTER_KEYS.DESCRIPTION || filterKey === FILTER_KEYS.REPORT_ID) && filterValue) {
                const keyInCorrectForm = (Object.keys(CONST.SEARCH.SYNTAX_FILTER_KEYS) as FilterKeys[]).find((key) => CONST.SEARCH.SYNTAX_FILTER_KEYS[key] === filterKey);
                if (keyInCorrectForm) {
                    return `${CONST.SEARCH.SYNTAX_FILTER_KEYS[keyInCorrectForm]}:${sanitizeString(filterValue as string)}`;
                }
            }

            if (filterKey === FILTER_KEYS.KEYWORD && filterValue) {
                const value = (filterValue as string).split(' ').map(sanitizeString).join(' ');
                return `${value}`;
            }

            if (
                (filterKey === FILTER_KEYS.CATEGORY ||
                    filterKey === FILTER_KEYS.CARD_ID ||
                    filterKey === FILTER_KEYS.TAX_RATE ||
                    filterKey === FILTER_KEYS.EXPENSE_TYPE ||
                    filterKey === FILTER_KEYS.TAG ||
                    filterKey === FILTER_KEYS.CURRENCY ||
                    filterKey === FILTER_KEYS.FROM ||
                    filterKey === FILTER_KEYS.TO ||
                    filterKey === FILTER_KEYS.IN) &&
                Array.isArray(filterValue) &&
                filterValue.length > 0
            ) {
                const filterValueArray = [...new Set<string>(filterValue)];
                const keyInCorrectForm = (Object.keys(CONST.SEARCH.SYNTAX_FILTER_KEYS) as FilterKeys[]).find((key) => CONST.SEARCH.SYNTAX_FILTER_KEYS[key] === filterKey);
                if (keyInCorrectForm) {
                    return `${CONST.SEARCH.SYNTAX_FILTER_KEYS[keyInCorrectForm]}:${filterValueArray.map(sanitizeString).join(',')}`;
                }
            }

            return undefined;
        })
        .filter((filter): filter is string => !!filter);

    filtersString.push(...mappedFilters);

    const dateFilter = buildDateFilterQuery(filterValues);
    filtersString.push(dateFilter);

    const amountFilter = buildAmountFilterQuery(filterValues);
    filtersString.push(amountFilter);
    return filtersString.join(' ').trim();
}

/**
 * returns the values of the filters in a format that can be used in the SearchAdvancedFiltersForm as initial form values
 */
function buildFilterFormValuesFromQuery(
    queryJSON: SearchQueryJSON,
    policyCategories: OnyxCollection<OnyxTypes.PolicyCategories>,
    policyTags: OnyxCollection<OnyxTypes.PolicyTagLists>,
    currencyList: OnyxTypes.CurrencyList,
    personalDetails: OnyxTypes.PersonalDetailsList,
    cardList: OnyxTypes.CardList,
    reports: OnyxCollection<OnyxTypes.Report>,
    taxRates: Record<string, string[]>,
) {
    const filters = queryJSON.flatFilters;
    const filterKeys = Object.keys(filters);
    const filtersForm = {} as Partial<SearchAdvancedFiltersForm>;
    const policyID = queryJSON.policyID;
    for (const filterKey of filterKeys) {
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.REPORT_ID || filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.MERCHANT || filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.DESCRIPTION) {
            filtersForm[filterKey] = filters[filterKey]?.[0]?.value.toString();
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.EXPENSE_TYPE) {
            filtersForm[filterKey] = filters[filterKey]
                ?.map((expenseType) => expenseType.value.toString())
                .filter((expenseType) => Object.values(CONST.SEARCH.TRANSACTION_TYPE).includes(expenseType as ValueOf<typeof CONST.SEARCH.TRANSACTION_TYPE>));
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.CARD_ID) {
            filtersForm[filterKey] = filters[filterKey]?.map((card) => card.value.toString()).filter((card) => Object.keys(cardList).includes(card));
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.TAX_RATE) {
            filtersForm[filterKey] = filters[filterKey]?.map((tax) => tax.value.toString()).filter((tax) => [...Object.values(taxRates)].flat().includes(tax));
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.IN) {
            filtersForm[filterKey] = filters[filterKey]?.map((report) => report.value.toString()).filter((id) => reports?.[`${ONYXKEYS.COLLECTION.REPORT}${id}`]);
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.FROM || filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.TO) {
            filtersForm[filterKey] = filters[filterKey]?.map((id) => id.value.toString()).filter((id) => Object.keys(personalDetails).includes(id));
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.CURRENCY) {
            filtersForm[filterKey] = filters[filterKey]?.filter((currency) => Object.keys(currencyList).includes(currency.value.toString())).map((currency) => currency.value.toString());
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.TAG) {
            const tags = policyID
                ? getTagNamesFromTagsLists(policyTags?.[`${ONYXKEYS.COLLECTION.POLICY_TAGS}${policyID}`] ?? {})
                : Object.values(policyTags ?? {})
                      .filter((item) => !!item)
                      .map((tagList) => getTagNamesFromTagsLists(tagList ?? {}))
                      .flat();
            filtersForm[filterKey] = filters[filterKey]?.map((tag) => tag.value.toString()).filter((name) => tags.includes(name));
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.CATEGORY) {
            const categories = policyID
                ? Object.values(policyCategories?.[`${ONYXKEYS.COLLECTION.POLICY_CATEGORIES}${policyID}`] ?? {}).map((category) => category.name)
                : Object.values(policyCategories ?? {})
                      .map((xd) => Object.values(xd ?? {}).map((category) => category.name))
                      .flat();
            filtersForm[filterKey] = filters[filterKey]?.map((category) => category.value.toString()).filter((name) => categories.includes(name));
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.KEYWORD) {
            filtersForm[filterKey] = filters[filterKey]
                ?.map((filter) => filter.value.toString())
                .map((filter) => {
                    if (filter.includes(' ')) {
                        return `"${filter}"`;
                    }
                    return filter;
                })
                .join(' ');
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.DATE) {
            filtersForm[FILTER_KEYS.DATE_BEFORE] = filters[filterKey]?.find((filter) => filter.operator === 'lt' && ValidationUtils.isValidDate(filter.value.toString()))?.value.toString();
            filtersForm[FILTER_KEYS.DATE_AFTER] = filters[filterKey]?.find((filter) => filter.operator === 'gt' && ValidationUtils.isValidDate(filter.value.toString()))?.value.toString();
        }
        if (filterKey === CONST.SEARCH.SYNTAX_FILTER_KEYS.AMOUNT) {
            filtersForm[FILTER_KEYS.LESS_THAN] = filters[filterKey]?.find((filter) => filter.operator === 'lt' && validateAmount(filter.value.toString(), 2))?.value.toString();
            filtersForm[FILTER_KEYS.GREATER_THAN] = filters[filterKey]?.find((filter) => filter.operator === 'gt' && validateAmount(filter.value.toString(), 2))?.value.toString();
        }
    }

    const [typeKey = '', typeValue] = Object.entries(CONST.SEARCH.DATA_TYPES).find(([, value]) => value === queryJSON.type) ?? [];
    filtersForm[FILTER_KEYS.TYPE] = typeValue ? queryJSON.type : CONST.SEARCH.DATA_TYPES.EXPENSE;
    const [statusKey] = Object.entries(CONST.SEARCH.STATUS).find(([, value]) => Object.values(value).includes(queryJSON.status)) ?? [];
    filtersForm[FILTER_KEYS.STATUS] = typeKey === statusKey ? queryJSON.status : CONST.SEARCH.STATUS.EXPENSE.ALL;

    if (queryJSON.policyID) {
        filtersForm[FILTER_KEYS.POLICY_ID] = queryJSON.policyID;
    }

    return filtersForm;
}

/**
 * Given a SearchQueryJSON this function will try to find the value of policyID filter saved in query
 * and return just the first policyID value from the filter.
 *
 * Note: `policyID` property can store multiple policy ids (just like many other search filters) as a comma separated value;
 * however there are several places in the app (related to WorkspaceSwitcher) that will accept only a single policyID.
 */
function getPolicyIDFromSearchQuery(queryJSON: SearchQueryJSON) {
    const policyIDFilter = queryJSON.policyID;

    if (!policyIDFilter) {
        return;
    }

    // policyID is a comma-separated value
    const [policyID] = policyIDFilter.split(',');

    return policyID;
}

function getDisplayValue(filterName: string, filter: string, personalDetails: OnyxTypes.PersonalDetailsList, cardList: OnyxTypes.CardList, reports: OnyxCollection<OnyxTypes.Report>) {
    if (filterName === CONST.SEARCH.SYNTAX_FILTER_KEYS.FROM || filterName === CONST.SEARCH.SYNTAX_FILTER_KEYS.TO) {
        // login can be an empty string
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        return personalDetails?.[filter]?.login || filter;
    }
    if (filterName === CONST.SEARCH.SYNTAX_FILTER_KEYS.CARD_ID) {
        return cardList[filter]?.bank || filter;
    }
    if (filterName === CONST.SEARCH.SYNTAX_FILTER_KEYS.IN) {
        return ReportUtils.getReportName(reports?.[`${ONYXKEYS.COLLECTION.REPORT}${filter}`]) || filter;
    }
    return filter;
}

function buildFilterString(filterName: string, queryFilters: QueryFilter[]) {
    const delimiter = filterName === CONST.SEARCH.SYNTAX_FILTER_KEYS.KEYWORD ? ' ' : ',';
    let filterValueString = '';
    queryFilters.forEach((queryFilter, index) => {
        // If the previous queryFilter has the same operator (this rule applies only to eq and neq operators) then append the current value
        if (
            index !== 0 &&
            ((queryFilter.operator === 'eq' && queryFilters?.at(index - 1)?.operator === 'eq') || (queryFilter.operator === 'neq' && queryFilters.at(index - 1)?.operator === 'neq'))
        ) {
            filterValueString += `${delimiter}${sanitizeString(queryFilter.value.toString())}`;
        } else if (filterName === CONST.SEARCH.SYNTAX_FILTER_KEYS.KEYWORD) {
            filterValueString += `${delimiter}${sanitizeString(queryFilter.value.toString())}`;
        } else {
            filterValueString += ` ${filterName}${operatorToSignMap[queryFilter.operator]}${sanitizeString(queryFilter.value.toString())}`;
        }
    });

    return filterValueString;
}

function getSearchHeaderTitle(
    queryJSON: SearchQueryJSON,
    PersonalDetails: OnyxTypes.PersonalDetailsList,
    cardList: OnyxTypes.CardList,
    reports: OnyxCollection<OnyxTypes.Report>,
    TaxRates: Record<string, string[]>,
) {
    const {type, status} = queryJSON;
    const filters = queryJSON.flatFilters ?? {};

    let title = `type:${type} status:${status}`;

    Object.keys(filters).forEach((key) => {
        const queryFilter = filters[key as ValueOf<typeof CONST.SEARCH.SYNTAX_FILTER_KEYS>] ?? [];
        let displayQueryFilters: QueryFilter[] = [];
        if (key === CONST.SEARCH.SYNTAX_FILTER_KEYS.TAX_RATE) {
            const taxRateIDs = queryFilter.map((filter) => filter.value.toString());
            const taxRateNames = taxRateIDs
                .map((id) => {
                    const taxRate = Object.entries(TaxRates)
                        .filter(([, IDs]) => IDs.includes(id))
                        .map(([name]) => name);
                    return taxRate?.length > 0 ? taxRate : id;
                })
                .flat();

            displayQueryFilters = taxRateNames.map((taxRate) => ({
                operator: queryFilter.at(0)?.operator ?? CONST.SEARCH.SYNTAX_OPERATORS.AND,
                value: taxRate,
            }));
        } else {
            displayQueryFilters = queryFilter.map((filter) => ({
                operator: filter.operator,
                value: getDisplayValue(key, filter.value.toString(), PersonalDetails, cardList, reports),
            }));
        }
        title += buildFilterString(key, displayQueryFilters);
    });

    return title;
}

function buildCannedSearchQuery({
    type = CONST.SEARCH.DATA_TYPES.EXPENSE,
    status = CONST.SEARCH.STATUS.EXPENSE.ALL,
    policyID,
}: {
    type?: SearchDataTypes;
    status?: SearchStatus;
    policyID?: string;
} = {}): SearchQueryString {
    const queryString = policyID ? `type:${type} status:${status} policyID:${policyID}` : `type:${type} status:${status}`;

    return normalizeQuery(queryString);
}

function getOverflowMenu(itemName: string, hash: number, inputQuery: string, showDeleteModal: (hash: number) => void, isMobileMenu?: boolean, closeMenu?: () => void) {
    return [
        {
            text: translateLocal('common.rename'),
            onSelected: () => {
                if (isMobileMenu && closeMenu) {
                    closeMenu();
                }
                Navigation.navigate(ROUTES.SEARCH_SAVED_SEARCH_RENAME.getRoute({name: encodeURIComponent(itemName), jsonQuery: inputQuery}));
            },
            icon: Expensicons.Pencil,
            shouldShowRightIcon: false,
            shouldShowRightComponent: false,
            shouldCallAfterModalHide: true,
        },
        {
            text: translateLocal('common.delete'),
            onSelected: () => showDeleteModal(hash),
            icon: Expensicons.Trashcan,
            shouldShowRightIcon: false,
            shouldShowRightComponent: false,
            shouldCallAfterModalHide: true,
            shouldCloseAllModals: true,
        },
    ];
}

/**
 * @private
 * Given a filter name and its value, this function will try to find the corresponding ID.
 */
function findIDFromDisplayValue(filterName: ValueOf<typeof CONST.SEARCH.SYNTAX_FILTER_KEYS>, filter: string | string[], cardList: OnyxTypes.CardList, taxRates: Record<string, string[]>) {
    if (filterName === CONST.SEARCH.SYNTAX_FILTER_KEYS.FROM || filterName === CONST.SEARCH.SYNTAX_FILTER_KEYS.TO) {
        if (typeof filter === 'string') {
            const email = filter;
            return PersonalDetailsUtils.getPersonalDetailByEmail(email)?.accountID.toString() ?? filter;
        }
        const emails = filter;
        return emails.map((email) => PersonalDetailsUtils.getPersonalDetailByEmail(email)?.accountID.toString() ?? email);
    }
    if (filterName === CONST.SEARCH.SYNTAX_FILTER_KEYS.TAX_RATE) {
        const names = Array.isArray(filter) ? filter : ([filter] as string[]);
        return names.map((name) => taxRates[name] ?? name).flat();
    }
    if (filterName === CONST.SEARCH.SYNTAX_FILTER_KEYS.CARD_ID) {
        if (typeof filter === 'string') {
            const bank = filter;
            const ids =
                Object.values(cardList)
                    .filter((card) => card.bank === bank)
                    .map((card) => card.cardID.toString()) ?? filter;
            return ids.length > 0 ? ids : bank;
        }
        const banks = filter;
        return banks
            .map(
                (bank) =>
                    Object.values(cardList)
                        .filter((card) => card.bank === bank)
                        .map((card) => card.cardID.toString()) ?? bank,
            )
            .flat();
    }
    return filter;
}

/**
 *  Given a search query, this function will standardize the query by replacing display values with their corresponding IDs.
 */
function standardizeQueryJSON(queryJSON: SearchQueryJSON, cardList: OnyxTypes.CardList, taxRates: Record<string, string[]>) {
    const standardQuery = cloneDeep(queryJSON);
    const filters = standardQuery.filters;
    const traverse = (node: ASTNode) => {
        if (!node.operator) {
            return;
        }
        if (typeof node.left === 'object' && node.left) {
            traverse(node.left);
        }
        if (typeof node.right === 'object' && node.right && !Array.isArray(node.right)) {
            traverse(node.right);
        }

        if (typeof node.left !== 'object') {
            // eslint-disable-next-line no-param-reassign
            node.right = findIDFromDisplayValue(node.left, node.right as string | string[], cardList, taxRates);
        }
    };

    if (filters) {
        traverse(filters);
    }

    standardQuery.flatFilters = getFilters(standardQuery);
    return standardQuery;
}

/**
 * Returns whether a given search query is a Canned query.
 *
 * Canned queries are simple predefined queries, that are defined only using type and status and no additional filters.
 * For example: "type:trip status:all" is a canned query.
 */
function isCannedSearchQuery(queryJSON: SearchQueryJSON) {
    return !queryJSON.filters;
}

function getContextualSuggestionQuery(reportID: string) {
    return `type:chat in:${reportID}`;
}

function isCorrectSearchUserName(displayName?: string) {
    return displayName && displayName.toUpperCase() !== CONST.REPORT.OWNER_EMAIL_FAKE;
}

export {
    getContextualSuggestionQuery,
    buildQueryStringFromFilterFormValues,
    buildSearchQueryJSON,
    buildSearchQueryString,
    buildFilterFormValuesFromQuery,
    getPolicyIDFromSearchQuery,
    getListItem,
    getSections,
    getShouldShowMerchant,
    getSortedSections,
    isReportListItemType,
    isSearchResultsEmpty,
    isTransactionListItemType,
    isReportActionListItemType,
    getSearchHeaderTitle,
    normalizeQuery,
    shouldShowYear,
    buildCannedSearchQuery,
    isCannedSearchQuery,
    getExpenseTypeTranslationKey,
    getOverflowMenu,
    isCorrectSearchUserName,
    standardizeQueryJSON,
};
