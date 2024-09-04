  TouchableOpacity,
  FlatList,
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon } from 'react-native-elements';
import { I18nextProvider, useTranslation } from 'react-i18next';
import i18n from './i18n';
import styles from './styles';

const CATEGORIES = [
  { key: 'general', icon: 'apps', color: '#7986CB' },
  { key: 'work', icon: 'work', color: '#4FC3F7' },
  { key: 'personal', icon: 'person', color: '#81C784' },
  { key: 'ai', icon: 'psychology', color: '#FFD54F' },
  { key: 'prompt', icon: 'code', color: '#FF8A65' },
];

const DEFAULT_CATEGORY = CATEGORIES[0];

const App = () => {
  const [notes, setNotes] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [currentNote, setCurrentNote] = useState({ id: '', title: '', content: '', category: DEFAULT_CATEGORY.key });
  const [searchQuery, setSearchQuery] = useState('');
  const [language, setLanguage] = useState('en');
  const { t } = useTranslation();

  useEffect(() => {
    loadNotes();
    loadLanguage();
  }, []);

  const loadNotes = async () => {
    try {
      const savedNotes = await AsyncStorage.getItem('notes');
      if (savedNotes) setNotes(JSON.parse(savedNotes));
    } catch (error) {
      console.error('Error loading notes:', error);
    }
  };

  const loadLanguage = async () => {
    try {
      const savedLanguage = await AsyncStorage.getItem('language');
      if (savedLanguage) {
        setLanguage(savedLanguage);
        i18n.changeLanguage(savedLanguage);
      }
    } catch (error) {
      console.error('Error loading language:', error);
    }
  };

  const saveNotes = async (updatedNotes) => {
    try {
      await AsyncStorage.setItem('notes', JSON.stringify(updatedNotes));
      setNotes(updatedNotes);
    } catch (error) {
      console.error('Error saving notes:', error);
    }
  };

  const addOrUpdateNote = () => {
    if (currentNote.title.trim() === '') return;
    const updatedNotes = currentNote.id
      ? notes.map(note => note.id === currentNote.id ? currentNote : note)
      : [...notes, { ...currentNote, id: Date.now().toString() }];
    saveNotes(updatedNotes);
    setModalVisible(false);
    setCurrentNote({ id: '', title: '', content: '', category: DEFAULT_CATEGORY.key });
  };

  const deleteNote = (id) => {
    const updatedNotes = notes.filter(note => note.id !== id);
    saveNotes(updatedNotes);
  };

  const renderNote = ({ item }) => {
    const category = CATEGORIES.find(cat => cat.key === item.category) || DEFAULT_CATEGORY;
    return (
      <TouchableOpacity
        style={styles.noteItem}
        onPress={() => {
          setCurrentNote(item);
          setModalVisible(true);
        }}
      >
        <View>
          <Text style={styles.noteTitle}>{item.title}</Text>
          <Text style={styles.noteContent} numberOfLines={2}>{item.content}</Text>
          <View style={styles.noteFooter}>
            <Icon name={category.icon} size={16} color={category.color} />
            <Text style={[styles.noteCategory, { color: category.color }]}>{t(item.category)}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => deleteNote(item.id)} style={styles.deleteButton}>
          <Icon name="delete" color={styles.deleteButton.color} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const filteredNotes = notes.filter(note =>
    note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    note.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const changeLanguage = (lang) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
    AsyncStorage.setItem('language', lang);
  };

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('appName')}</Text>
            <View style={styles.headerButtons}>
              <Button
                icon={<Icon name="language" color={styles.headerIcon.color} />}
                type="clear"
                onPress={() => changeLanguage(language === 'en' ? 'ar' : 'en')}
              />
              <Button
                icon={<Icon name="info" color={styles.headerIcon.color} />}
                type="clear"
                onPress={() => setInfoModalVisible(true)}
              />
            </View>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder={t('search')}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <View style={styles.categoriesContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoriesScroll}>
              {CATEGORIES.map((category) => (
                <TouchableOpacity
                  key={category.key}
                  style={[styles.categoryChip, { backgroundColor: category.color }]}
                  onPress={() => setSearchQuery(t(category.key))}
                >
                  <Icon name={category.icon} size={16} color="#FFFFFF" />
                  <Text style={styles.categoryChipText}>{t(category.key)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <FlatList
            data={filteredNotes}
            renderItem={renderNote}
            keyExtractor={(item) => item.id}
          />
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => {
              setCurrentNote({ id: '', title: '', content: '', category: DEFAULT_CATEGORY.key });
              setModalVisible(true);
            }}
          >
            <Icon name="add" color={styles.addButton.iconColor} />
          </TouchableOpacity>

          <Modal
            animationType="slide"
            transparent={true}
            visible={modalVisible}
            onRequestClose={() => setModalVisible(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalView}>
                <TextInput
                  style={styles.input}
                  placeholder={t('title')}
                  value={currentNote.title}
                  onChangeText={(text) => setCurrentNote({ ...currentNote, title: text })}
                />
                <TextInput
                  style={[styles.input, styles.contentInput]}
                  placeholder={t('content')}
                  value={currentNote.content}
                  onChangeText={(text) => setCurrentNote({ ...currentNote, content: text })}
                  multiline
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoriesScroll}>
                  {CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={category.key}
                      style={[
                        styles.categoryChip,
                        { backgroundColor: category.color },
                        currentNote.category === category.key && styles.selectedCategory
                      ]}
                      onPress={() => setCurrentNote({ ...currentNote, category: category.key })}
                    >
                      <Icon name={category.icon} size={16} color="#FFFFFF" />
                      <Text style={styles.categoryChipText}>{t(category.key)}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.modalButtons}>
                  <Button title={t('save')} onPress={addOrUpdateNote} buttonStyle={styles.saveButton} />
                  <Button title={t('cancel')} onPress={() => setModalVisible(false)} type="outline" buttonStyle={styles.cancelButton} />
                </View>
              </View>
            </View>
          </Modal>

          <Modal
            animationType="fade"
            transparent={true}
            visible={infoModalVisible}
            onRequestClose={() => setInfoModalVisible(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalView}>
                <ScrollView>
                  <Text style={styles.modalTitle}>{t('privacyPolicy')}</Text>
                  <Text style={styles.modalText}>{t('privacyPolicyText')}</Text>
                  <Text style={styles.modalTitle}>{t('termsAndConditions')}</Text>
                  <Text style={styles.modalText}>{t('termsAndConditionsText')}</Text>
                  <Text style={styles.modalTitle}>{t('openSource')}</Text>
                  <Text style={styles.modalText}>{t('openSourceInfo')}</Text>
                  <TouchableOpacity onPress={() => Linking.openURL('https://github.com/zizwar/proomy-note')}>
                    <Text style={styles.link}>{t('viewOnGitHub')}</Text>
                  </TouchableOpacity>
                </ScrollView>
                <Button title={t('close')} onPress={() => setInfoModalVisible(false)} buttonStyle={styles.closeButton} />
              </View>
            </View>
          </Modal>
        </SafeAreaView>
      </I18nextProvider>
    </SafeAreaProvider>
  );
};

export default App;