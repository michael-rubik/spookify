import React, {Component} from 'react';
import SpotifyWebApi from 'spotify-web-api-js';

class SearchSpotify extends Component{
    state = { query: "" }

    accessSpotifyAPI = async (query) => {
        const spotify = new SpotifyWebApi();
        //User Token from https://developer.spotify.com/console/post-playlist-tracks/
        //user-modify-playback-state for Queue
        let token = "---";

        spotify.setAccessToken(token)
        spotify.searchTracks(query, { limit: 1 }).then(
            (data) => {
                console.log("Search results", data.tracks.items)
                alert(data.tracks.items[0].name + " by " + data.tracks.items[0].artists[0].name);
                spotify.addTracksToPlaylist("----", ["spotify:track:"+data.tracks.items[0].id.toString()]); //Playlist ID
                //spotify.queue(["spotify:track:"+data.tracks.items[0].id.toString()]); //Queue song
            },
            (err) => {
            console.error(err);
            }

        )} 
      
      handleChange = (e) => this.setState({ query: e.target.value })
      handleSubmit = (e) => {
        e.preventDefault();        
        this.accessSpotifyAPI(this.state.query)
        this.setState({ query: '' })
      }    
  
      render() {
          return (
              <div>
                  <h2>SEARCH FOR A SONG</h2>
                  <form onSubmit={ this.handleSubmit }>
                      <input type="text" onChange={ this.handleChange } value={this.state.query} placeholder='Enter the name of a song, artist, or album' />
                      <input type="submit" value="Submit" />
                  </form>
              </div>
          )
      }
}

export default SearchSpotify;