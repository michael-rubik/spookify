import './App.css';
import SearchSpotify from './SearchSpotify';
import AuthorizeSpotify from './AuthorizeSpotify';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <SearchSpotify />
        <AuthorizeSpotify/>
      </header>
    </div>
  );
}

export default App;
