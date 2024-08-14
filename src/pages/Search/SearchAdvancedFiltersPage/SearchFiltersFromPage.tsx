import React from 'react';
import {View} from 'react-native';
import {useOnyx} from 'react-native-onyx';
import HeaderWithBackButton from '@components/HeaderWithBackButton';
import ScreenWrapper from '@components/ScreenWrapper';
import SearchFiltersParticipantsSelector from '@components/Search/SearchFiltersParticipantsSelector';
import useLocalize from '@hooks/useLocalize';
import useThemeStyles from '@hooks/useThemeStyles';
import * as SearchActions from '@userActions/Search';
import ONYXKEYS from '@src/ONYXKEYS';

function SearchFiltersFromPage() {
    const styles = useThemeStyles();
    const {translate} = useLocalize();

    const [searchAdvancedFiltersForm] = useOnyx(ONYXKEYS.FORMS.SEARCH_ADVANCED_FILTERS_FORM);

    return (
        <ScreenWrapper
            testID={SearchFiltersFromPage.displayName}
            includeSafeAreaPaddingBottom={false}
            shouldShowOfflineIndicatorInWideScreen
            offlineIndicatorStyle={styles.mtAuto}
        >
            <HeaderWithBackButton title={translate('common.from')} />
            <View style={[styles.flex1]}>
                <SearchFiltersParticipantsSelector
                    initialAccountIDs={searchAdvancedFiltersForm?.from ?? []}
                    onFiltersUpdate={(selectedAccountIDs) => {
                        SearchActions.updateAdvancedFilters({
                            from: selectedAccountIDs,
                        });
                    }}
                />
            </View>
        </ScreenWrapper>
    );
}

SearchFiltersFromPage.displayName = 'SearchFiltersFromPage';

export default SearchFiltersFromPage;