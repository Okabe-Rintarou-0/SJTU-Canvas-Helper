use std::{collections::HashMap, sync::Mutex};

use serde::{de::DeserializeOwned, Serialize};

use crate::{
    error::{AppError, Result},
    utils::parse_json,
};

#[derive(Debug, Default)]
pub struct Cache {
    inner: Mutex<HashMap<String, String>>,
}

impl Cache {
    pub fn get<V>(&self, key: &str) -> Result<Option<V>>
    where
        V: DeserializeOwned + Serialize,
    {
        let cache = self.inner.lock().map_err(|_| AppError::MutexError)?;
        let value = cache.get(key);
        match value {
            Some(v) => {
                let value = parse_json(v.as_bytes())?;
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }

    pub fn set<K, V>(&self, key: K, value: V) -> Result<()>
    where
        K: Into<String>,
        V: DeserializeOwned + Serialize,
    {
        let mut cache = self.inner.lock().map_err(|_| AppError::MutexError)?;
        let value = serde_json::to_string(&value)?;
        cache.insert(key.into(), value);
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        let mut cache = self.inner.lock().map_err(|_| AppError::MutexError)?;
        cache.clear();
        Ok(())
    }

    #[allow(dead_code)]
    pub fn remove<V>(&self, key: &str) -> Result<Option<V>>
    where
        V: DeserializeOwned + Serialize,
    {
        let mut cache = self.inner.lock().map_err(|_| AppError::MutexError)?;

        let value = cache.get(key);
        match value {
            Some(v) => {
                let value = parse_json(v.as_bytes())?;
                cache.remove(key);
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }
}

mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
    struct Person {
        age: usize,
        gender: String,
        name: String,
    }

    #[derive(Serialize, Deserialize)]
    struct Pet {
        name: String,
        owner: String,
    }

    #[test]
    fn test_cache() -> Result<()> {
        const PERSON_CACHE_KEY: &str = "person_cache_key";
        let test_person = Person {
            age: 25,
            gender: "male".to_owned(),
            name: "Alice".to_owned(),
        };

        let cache = Cache::default();

        // person is not set yet
        let mut person: Option<Person> = cache.get(PERSON_CACHE_KEY)?;
        assert!(person.is_none());
        // set person
        cache.set(PERSON_CACHE_KEY, test_person.clone()).unwrap();
        // person is now set
        person = cache.get(PERSON_CACHE_KEY)?;
        assert!(person.is_some());
        assert_eq!(test_person, person.unwrap());

        // try to get person as a pet, will fail
        let result: Result<Option<Pet>> = cache.get(PERSON_CACHE_KEY);
        assert!(result.is_err());
        Ok(())
    }
}
